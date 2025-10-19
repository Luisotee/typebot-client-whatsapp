import { PrismaClient } from "@prisma/client";
import { ProcessedMessage, ServiceResponse } from "../types/common.types";
import { appLogger } from "../utils/logger";
import {
  sendTextMessage,
  sendVideoMessage,
  sendImageMessage,
  sendQueuedReaction,
  sendWorkingReaction,
  sendDoneReaction,
  sendErrorReaction,
  downloadMedia,
  sendButtonMessage,
  sendListMessage,
} from "./unified-whatsapp.service";
import {
  startChat,
  continueChat,
  processMessagesForWhatsApp,
  extractChoicesFromInput,
  createWhatsAppButtons,
  createWhatsAppList,
  isValidSessionId,
  handleTypebotRedirect,
} from "./typebot.service";
import { transcribeAudio } from "./transcription.service";
import { enhanceTranscriptionWithChoiceMatch } from "./choice-matcher.service";
import {
  getOrCreateUser,
  storeMessage,
  getActiveChoices,
  clearActiveChoices,
  setActiveChoices,
  getActiveSessionsCount,
  getActiveSessionId,
  getActiveTypebotId,
  setActiveTypebotId,
} from "./session.service";
import { typebot, whitelist } from "../config/config";
import { handleCommand } from "./command-handler.service";
import { isWhitelisted } from "./whitelist.service";

/**
 * Converts Google Drive URLs to WhatsApp-compatible direct URLs
 */
function convertToDirectVideoUrl(url: string): string {
  // Handle Google Drive URLs
  if (url.includes('drive.google.com')) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      return `https://drive.usercontent.google.com/download?id=${match[1]}&export=download`;
    }
  }
  
  // Return original URL if no conversion needed (already direct)
  return url;
}

/**
 * Main message processing pipeline
 */
export async function processMessage(
  prisma: PrismaClient,
  message: ProcessedMessage
): Promise<void> {
  const startTime = Date.now();
  const context = {
    waId: message.waId,
    messageId: message.id,
    sessionId: message.sessionId,
    operation: "process_message",
  };


  try {
    // Step 1: Check whitelist first (before processing anything)
    if (whitelist.enabled) {
      const allowed = await isWhitelisted(message.waId);

      if (!allowed) {
        appLogger.warn({ waId: message.waId }, 'User not in whitelist, message rejected');

        // Send a polite rejection message
        await sendTextMessage(
          message.waId,
          '⚠️ Desculpe, mas você não tem permissão para usar este bot. Entre em contato com o administrador.'
        );
        await sendErrorReaction(message.waId, message.id);
        return;
      }
    }

    // Step 2: Check for admin commands (after whitelist check)
    if (message.type === "text") {
      const commandResult = await handleCommand(message.content, message.waId);

      if (commandResult.handled) {
        // Command was handled, send response if any
        if (commandResult.response) {
          await sendTextMessage(message.waId, commandResult.response);
          await sendDoneReaction(message.waId, message.id);
        }

        // Don't continue with normal processing unless specified
        if (!commandResult.shouldContinue) {
          appLogger.info({
            waId: message.waId,
            command: message.content,
            duration: Date.now() - startTime
          }, 'Command processed successfully');
          return;
        }
      }
    }

    // Step 3: Get or create user
    const userResult = await getOrCreateUser(prisma, message.waId);
    if (!userResult.success || !userResult.data) {
      throw new Error(`Failed to get/create user: ${userResult.error}`);
    }

    const { userId } = userResult.data;

    // Step 2: Store incoming message
    await storeMessage(
      prisma,
      userId,
      message.content,
      "in",
      message.sessionId,
      message.waId
    );

    // Step 3: Check for VOLTAR command (reset to original typebot)
    if (message.type === "text" && message.content.trim().toUpperCase() === "VOLTAR") {
      appLogger.info({ waId: message.waId, userId }, "User requested VOLTAR - resetting to original typebot");
      
      // Send working reaction
      await sendWorkingReaction(message.waId, message.id);
      
      // Clear user's active session and typebot
      await setActiveTypebotId(prisma, message.waId, typebot.id);
      clearActiveChoices(message.waId);
      
      // Start new session with original typebot
      const resetResponse = await startChat({}, message.waId, typebot.id, prisma);
      if (!resetResponse.success) {
        appLogger.error({ waId: message.waId, userId, error: resetResponse.error }, "Failed to start reset session");
        await sendErrorReaction(message.waId, message.id, message.waId);
        return;
      }

      const typebotResponse = resetResponse.data;
      
      // Update user's session info with the new session
      await getOrCreateUser(prisma, message.waId);
      
      // Process and send Typebot response
      await sendTypebotResponse(
        prisma,
        typebotResponse,
        message.waId,
        userId,
        context
      );
      
      // Send success reaction
      await sendDoneReaction(message.waId, message.id);
      
      appLogger.info({ 
        waId: message.waId, 
        userId, 
        newSessionId: typebotResponse?.sessionId 
      }, "Successfully reset user to original typebot");
      
      return;
    }

    // Step 4: Send initial reaction
    await sendQueuedReaction(message.waId, message.id);

    // Step 5: Process message content
    let finalContent = message.content;
    let shouldSendToTypebot = true;

    if (message.type === "audio" && message.mediaUrl) {
      const audioResult = await processAudioMessage(message);
      if (audioResult.success && audioResult.data) {
        finalContent = audioResult.data.finalContent;
        shouldSendToTypebot = audioResult.data.shouldSendToTypebot;

        if (audioResult.data.transcription) {
          message.transcription = audioResult.data.transcription;
        }
      } else {
        finalContent = "Sorry, I couldn't process your audio message.";
        shouldSendToTypebot = false;
      }
    } else if (message.type === "text") {
      // Check for numeric choice selection (e.g., "1", "2", "3")
      const numericResult = processNumericChoice(message.content, message.waId);
      if (numericResult.matched) {
        finalContent = numericResult.content;
        appLogger.info({
          waId: message.waId,
          originalInput: message.content,
          matchedChoice: finalContent,
        }, '🔢 Matched numeric choice selection');
      }
    }

    // Step 5: Send working reaction
    await sendWorkingReaction(message.waId, message.id);

    if (shouldSendToTypebot) {
      // Step 6: Interact with Typebot
      const typebotResult = await interactWithTypebot(
        prisma,
        finalContent,
        message.sessionId,
        message.waId
      );

      if (typebotResult.success && typebotResult.data) {

        // Step 7: Process and send Typebot response
        await sendTypebotResponse(
          prisma,
          typebotResult.data,
          message.waId,
          userId,
          context
        );

        // Step 8: Send success reaction
        await sendDoneReaction(message.waId, message.id);

        appLogger.messageProcessingComplete({
          ...context,
          success: true,
          responseType: "typebot_response",
          duration: Date.now() - startTime,
        });
      } else {
        throw new Error(`Typebot interaction failed: ${typebotResult.error}`);
      }
    } else {
      // Send direct response (e.g., transcription error)
      await sendTextMessage(message.waId, finalContent);
      await sendErrorReaction(message.waId, message.id);

      appLogger.messageProcessingComplete({
        ...context,
        success: false,
        responseType: "direct_response",
        duration: Date.now() - startTime,
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    // Send error reaction
    await sendErrorReaction(message.waId, message.id);

    appLogger.messageProcessingComplete({
      ...context,
      success: false,
      duration,
      error: error instanceof Error ? error.message : String(error),
    });

    appLogger.error(
      context,
      "Message processing failed",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Processes numeric choice selection (e.g., "1", "2", "3")
 */
function processNumericChoice(content: string, waId: string): { matched: boolean; content: string } {
  // Get active choices for this user
  const activeChoices = getActiveChoices(waId);

  if (!activeChoices || activeChoices.length === 0) {
    return { matched: false, content };
  }

  // Check if the content is a number
  const trimmedContent = content.trim();
  const choiceNumber = parseInt(trimmedContent, 10);

  // Validate the number is within the valid range
  if (!isNaN(choiceNumber) && choiceNumber >= 1 && choiceNumber <= activeChoices.length) {
    const selectedChoice = activeChoices[choiceNumber - 1]; // Array is 0-indexed

    // Clear active choices after successful match
    clearActiveChoices(waId);

    return {
      matched: true,
      content: selectedChoice.content
    };
  }

  return { matched: false, content };
}

/**
 * Processes audio messages with transcription and choice matching
 */
async function processAudioMessage(message: ProcessedMessage): Promise<
  ServiceResponse<{
    finalContent: string;
    shouldSendToTypebot: boolean;
    transcription?: any;
  }>
> {
  const context = {
    waId: message.waId,
    messageId: message.id,
    operation: "process_audio",
  };

  try {
    if (!message.mediaUrl && !message.baileysMessage) {
      return { success: false, error: "No media URL or Baileys message provided" };
    }

    // Download audio - use baileysMessage if available (for Baileys mode), otherwise use mediaUrl (for Meta mode)
    const downloadTarget = message.baileysMessage || message.mediaUrl;
    const downloadResult = await downloadMedia(downloadTarget, message.waId);
    if (!downloadResult.success || !downloadResult.data) {
      appLogger.error({
        ...context,
        error: downloadResult.error,
        hasBaileysMessage: !!message.baileysMessage,
        hasMediaUrl: !!message.mediaUrl
      }, 'Failed to download audio');
      return {
        success: false,
        error: `Failed to download audio: ${downloadResult.error}`,
      };
    }

    // Transcribe audio
    const transcriptionResult = await transcribeAudio(
      downloadResult.data,
      "audio/ogg", // WhatsApp default
      message.waId
    );

    if (!transcriptionResult.success || !transcriptionResult.data) {
      return {
        success: true,
        data: {
          finalContent: "Sorry, I couldn't transcribe your audio message.",
          shouldSendToTypebot: false,
        },
      };
    }

    let finalContent = transcriptionResult.data.text;
    let shouldSendToTypebot = true;

    // Check for active choices and try to match
    const activeChoices = getActiveChoices(message.waId);
    if (activeChoices && activeChoices.length > 0) {
      const enhancedResult = await enhanceTranscriptionWithChoiceMatch(
        transcriptionResult.data,
        activeChoices,
        message.waId
      );

      if (enhancedResult.matchedChoice) {
        finalContent = enhancedResult.matchedChoice.content;
        // Clear choices after successful match
        clearActiveChoices(message.waId);
      }
    }

    return {
      success: true,
      data: {
        finalContent,
        shouldSendToTypebot,
        transcription: transcriptionResult.data,
      },
    };
  } catch (error) {
    appLogger.error(
      context,
      "Error processing audio message",
      error instanceof Error ? error : new Error(String(error))
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Interacts with Typebot API
 */
async function interactWithTypebot(
  prisma: PrismaClient,
  content: string,
  sessionId?: string,
  waId?: string
): Promise<ServiceResponse<any>> {
  const activeTypebotId = waId ? await getActiveTypebotId(prisma, waId) : null;
  const activeSessionId = waId ? await getActiveSessionId(prisma, waId) : null;

  // Use the session ID from the database if no explicit session was provided
  const effectiveSessionId = sessionId || activeSessionId;

  const context = {
    waId,
    sessionId,
    effectiveSessionId,
    operation: "typebot_interaction",
    activeTypebotId,
  };

  try {
    // Log which API call we're making and with which typebot
    appLogger.info(
      {
        ...context,
        apiDecision: {
          hasProvidedSessionId: !!sessionId,
          hasActiveSessionId: !!activeSessionId,
          effectiveSessionId,
          sessionIdValid: effectiveSessionId
            ? isValidSessionId(effectiveSessionId)
            : false,
          hasActiveTypebotId: !!activeTypebotId,
          activeTypebotId,
          willUse:
            effectiveSessionId && isValidSessionId(effectiveSessionId)
              ? "continueChat"
              : "startChat",
          typebotIdForStart: activeTypebotId || "default_from_env",
        },
      },
      `🎯 Typebot API call decision: ${
        effectiveSessionId && isValidSessionId(effectiveSessionId)
          ? "continueChat"
          : "startChat"
      }`
    );

    if (effectiveSessionId && isValidSessionId(effectiveSessionId)) {
      // Try to continue existing conversation
      const continueResult = await continueChat(
        {
          message: content,
          sessionId: effectiveSessionId,
        },
        waId
      );

      // If the session is no longer valid, clear it and start a new conversation
      if (
        !continueResult.success &&
        continueResult.error?.includes("Session not found")
      ) {
        appLogger.info(
          {
            ...context,
            expiredSessionId: effectiveSessionId,
          },
          "🔄 Session expired, clearing and starting new conversation"
        );

        // Clear the expired session from database
        if (waId && prisma) {
          await setActiveTypebotId(prisma, waId, activeTypebotId || typebot.id, null);
        }

        // Start a new conversation
        return await startChat(
          {
            message: content,
          },
          waId,
          activeTypebotId || undefined,
          prisma
        );
      }

      return continueResult;
    } else {
      // Start new conversation (possibly with redirected typebot)
      return await startChat(
        {
          message: content,
        },
        waId,
        activeTypebotId || undefined,
        prisma
      );
    }
  } catch (error) {
    appLogger.error(
      context,
      "Error interacting with Typebot",
      error instanceof Error ? error : new Error(String(error))
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Processes and sends Typebot response to WhatsApp
 */
async function sendTypebotResponse(
  prisma: PrismaClient,
  typebotResponse: any,
  waId: string,
  userId: number,
  context: any
): Promise<void> {
  try {
    // Check for redirects in multiple places
    let redirectToHandle = null;

    // Check direct redirect field
    if (typebotResponse.redirect) {
      redirectToHandle = typebotResponse.redirect;
    }

    // Check clientSideActions for redirect
    if (!redirectToHandle && typebotResponse.clientSideActions) {
      for (const action of typebotResponse.clientSideActions) {
        const typedAction = action as any;
        if (typedAction.type === "redirect" && typedAction.url) {
          redirectToHandle = { url: typedAction.url, isNewTab: typedAction.isNewTab };
          break;
        }
      }
    }

    // Handle the redirect if found
    if (redirectToHandle) {
      const redirectResult = await handleTypebotRedirect(
        prisma,
        redirectToHandle,
        typebotResponse.sessionId,
        waId
      );

      if (!redirectResult.success) {
        appLogger.error(
          { ...context },
          `Failed to handle redirect: ${redirectResult.error}`
        );
        // Continue with normal processing if redirect fails
      } else {
        // Continue processing messages if any came with the redirect response
        // The new typebot session will handle future messages
      }
    }

    // Process messages for WhatsApp
    const processedMessages = processMessagesForWhatsApp(typebotResponse.messages || []);

    // Send each message
    for (const msg of processedMessages) {
      let result;

      switch (msg.type) {
        case "text":
          appLogger.info({ content: msg.content, length: msg.content.length }, "📤 Sending text message content");
          result = await sendTextMessage(waId, msg.content, waId);
          break;
        case "image":
          result = await sendImageMessage(waId, msg.url!, msg.caption, waId);
          break;
        case "video":
          // Convert video URL to WhatsApp-compatible format
          const videoUrl = convertToDirectVideoUrl(msg.url || "");
          result = await sendVideoMessage(waId, videoUrl, msg.caption, waId);
          break;
        default:
          result = await sendTextMessage(waId, msg.content, waId);
      }

      // Store outgoing message
      if (result.success) {
        await storeMessage(
          prisma,
          userId,
          msg.content || msg.caption || "[Media]",
          "out",
          typebotResponse.sessionId,
          waId
        );
      }
    }

    // Handle input/choices
    if (typebotResponse.input) {
      await handleTypebotInput(typebotResponse.input, typebotResponse.sessionId, waId);
    }
  } catch (error) {
    appLogger.error(
      context,
      "Error sending Typebot response",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * Handles Typebot input (choices, buttons, etc.)
 */
async function handleTypebotInput(
  input: any,
  sessionId: string,
  waId: string
): Promise<void> {
  const context = { waId, sessionId, operation: "handle_typebot_input" };

  try {
    if (input.type === "choice input") {
      const choices = extractChoicesFromInput(input);

      if (choices.length > 0) {
        // Set active choices for audio matching
        setActiveChoices(waId, sessionId, choices);

        // Send as buttons or list based on count
        if (choices.length <= 3) {
          const buttons = createWhatsAppButtons(choices);
          await sendButtonMessage(waId, "Por favor, escolha uma opção:", buttons, waId);
        } else {
          const sections = createWhatsAppList(choices, "Opções");
          await sendListMessage(
            waId,
            "Por favor, escolha uma opção:",
            "Ver Opções",
            sections,
            waId
          );
        }
      }
    }
  } catch (error) {
    appLogger.error(
      context,
      "Error handling Typebot input",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Gets active sessions count for monitoring
 */
export function getActiveSessionsCountForProcessing(): number {
  return getActiveSessionsCount();
}
