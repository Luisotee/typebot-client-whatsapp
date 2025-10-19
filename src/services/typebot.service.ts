import {
  TypebotStartChatRequest,
  TypebotStartChatResponse,
  TypebotContinueChatRequest,
  TypebotContinueChatResponse,
  TypebotMessage,
  TypebotApiError,
  TypebotRedirect,
} from "../types/typebot.types";
import { ServiceResponse } from "../types/common.types";
import { typebot } from "../config/config";
import { appLogger } from "../utils/logger";
import { withServiceResponse, withRetry } from "../utils/retry";
import { setActiveTypebotId } from "./session.service";
import { PrismaClient } from "@prisma/client";

/**
 * Starts a new chat session with Typebot
 */
export async function startChat(
  request: TypebotStartChatRequest = {},
  waId?: string,
  typebotId?: string,
  prisma?: PrismaClient
): Promise<ServiceResponse<TypebotStartChatResponse>> {
  const activeTypebotId = typebotId || typebot.id; // Use provided ID or default
  const context = { waId, operation: "typebot_start_chat", typebotId: activeTypebotId };
  const endpoint = `${typebot.apiBase}/typebots/${activeTypebotId}/startChat`;

  appLogger.typebotApiCall({
    ...context,
    endpoint: `/typebots/${activeTypebotId}/startChat`,
    method: "POST",
    requestBody: request,
  });

  return withServiceResponse(async () => {
    const response = await makeApiCall<TypebotStartChatResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });

    // Check if we got redirected to a different typebot
    const returnedTypebotId = response.typebot?.id;
    const requestedSlug = activeTypebotId;

    // Extract the actual slug from the typebot response (if different from requested)
    // This handles cases where the initial typebot immediately redirects to another
    let actualTypebotSlug = requestedSlug;

    // Log the comparison for debugging
    appLogger.info(
      {
        ...context,
        requestedSlug,
        returnedTypebotId,
        sessionId: response.sessionId,
        typebotMetadata: response.typebot,
      },
      "📝 Typebot startChat response - checking for implicit redirect"
    );

    // Store the active typebot slug and session in database if user is provided
    if (waId && prisma) {
      const setResult = await setActiveTypebotId(
        prisma,
        waId,
        activeTypebotId,
        response.sessionId
      );
      if (!setResult.success) {
        appLogger.warn(
          { ...context, sessionId: response.sessionId },
          `Failed to persist typebot session: ${setResult.error}`
        );
      } else {
        appLogger.debug(
          { ...context, sessionId: response.sessionId },
          "Stored initial typebot slug and session in database"
        );
      }
    }

    appLogger.typebotApiSuccess({
      ...context,
      endpoint: `/typebots/${activeTypebotId}/startChat`,
      messagesCount: response.messages?.length || 0,
      sessionId: response.sessionId,
      hasInput: !!response.input,
      hasClientSideActions: !!response.clientSideActions,
      clientSideActionTypes:
        response.clientSideActions?.map((action) => action.type) || [],
      requestedSlug: activeTypebotId,
      returnedTypebotId,
    });

    return response;
  }, context);
}

/**
 * Continues an existing chat session with Typebot
 */
export async function continueChat(
  request: TypebotContinueChatRequest,
  waId?: string
): Promise<ServiceResponse<TypebotContinueChatResponse>> {
  const context = {
    waId,
    sessionId: request.sessionId,
    operation: "typebot_continue_chat",
  };
  const endpoint = `${typebot.apiBase}/sessions/${request.sessionId}/continueChat`;

  appLogger.typebotApiCall({
    ...context,
    endpoint: `/sessions/${request.sessionId}/continueChat`,
    method: "POST",
    requestBody: { message: request.message },
  });

  return withServiceResponse(async () => {
    const response = await makeApiCall<TypebotContinueChatResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify({ message: request.message }),
    });

    appLogger.typebotApiSuccess({
      ...context,
      endpoint: `/sessions/${request.sessionId}/continueChat`,
      messagesCount: response.messages?.length || 0,
      hasInput: !!response.input,
      hasRedirect: !!response.redirect,
      hasClientSideActions: !!response.clientSideActions,
      clientSideActionTypes:
        response.clientSideActions?.map((action) => action.type) || [],
    });

    return response;
  }, context);
}

/**
 * Updates the typebot in an existing session (for redirects)
 */
export async function updateTypebotInSession(
  sessionId: string,
  newTypebotId: string,
  waId?: string
): Promise<ServiceResponse<any>> {
  const context = { waId, sessionId, operation: "typebot_update_in_session" };
  const endpoint = `${typebot.apiBase}/sessions/${sessionId}/updateTypebot`;

  appLogger.typebotApiCall({
    ...context,
    endpoint: `/sessions/${sessionId}/updateTypebot`,
    method: "POST",
  });

  return withServiceResponse(async () => {
    const response = await makeApiCall<any>(endpoint, {
      method: "POST",
      body: JSON.stringify({ typebotId: newTypebotId }),
    });

    appLogger.typebotApiSuccess({
      ...context,
      endpoint: `/sessions/${sessionId}/updateTypebot`,
      messagesCount: 0,
      newTypebotId,
    });

    return response;
  }, context);
}

/**
 * Translates common Typebot error messages to Brazilian Portuguese
 */
function translateTypebotMessage(text: string): string {
  const translations: Record<string, string> = {
    'Invalid message. Please, try again.': 'Mensagem inválida. Por favor, tente novamente.',
    'Invalid message.': 'Mensagem inválida.',
    'Please, try again.': 'Por favor, tente novamente.',
    'Please try again.': 'Por favor, tente novamente.',
    'Invalid input.': 'Entrada inválida.',
    'Invalid option.': 'Opção inválida.',
    'Please select a valid option.': 'Por favor, selecione uma opção válida.',
    'Please enter a valid value.': 'Por favor, insira um valor válido.',
  };

  // Check for exact match first
  if (translations[text]) {
    return translations[text];
  }

  // Check for partial matches (case insensitive)
  const lowerText = text.toLowerCase();
  for (const [english, portuguese] of Object.entries(translations)) {
    if (lowerText.includes(english.toLowerCase())) {
      return text.replace(new RegExp(english, 'gi'), portuguese);
    }
  }

  return text;
}

/**
 * Recursively extracts text from a rich text node and its children
 */
function extractTextFromNode(node: any): string {
  // If node has direct text, return it
  if (node.text) {
    return node.text;
  }

  // If node has children, recursively extract text from them
  if (node.children && Array.isArray(node.children)) {
    return node.children.map((child: any) => extractTextFromNode(child)).join('');
  }

  return '';
}

/**
 * Extracts text content from Typebot rich text format
 */
export function extractTextFromMessage(message: TypebotMessage): string {
  if (!message.content.richText) {
    return "";
  }

  const extractedText = message.content.richText
    .map((richText) => extractTextFromNode(richText))
    .join("\n")
    .trim();

  // Translate common error messages to Portuguese
  const translatedText = translateTypebotMessage(extractedText);

  appLogger.info({
    originalRichText: message.content.richText,
    extractedText,
    translatedText,
    wasTranslated: extractedText !== translatedText,
    extractedLength: translatedText.length
  }, "🔍 Text extraction from Typebot message");

  return translatedText;
}

/**
 * Processes Typebot messages for WhatsApp compatibility
 */
export function processMessagesForWhatsApp(messages: TypebotMessage[]): Array<{
  type: string;
  content: string;
  url?: string;
  caption?: string;
}> {
  return messages
    .map((message) => {
      switch (message.type) {
        case "text":
          return {
            type: "text",
            content: extractTextFromMessage(message),
          };

        case "image":
          return {
            type: "image",
            content: "",
            url: message.content.url,
            caption: extractTextFromMessage(message),
          };

        case "video":
          return {
            type: "video",
            content: "",
            url: message.content.url,
            caption: extractTextFromMessage(message),
          };

        default:
          // Fallback to text for unsupported types
          return {
            type: "text",
            content: extractTextFromMessage(message) || `[${message.type} content]`,
          };
      }
    })
    .filter((msg) => msg.content || msg.url);
}

/**
 * Extracts choices from Typebot input for audio matching
 */
export function extractChoicesFromInput(
  input: any
): Array<{ id: string; content: string }> {
  if (!input || input.type !== "choice input") {
    return [];
  }

  const choices: Array<{ id: string; content: string }> = [];

  // Extract from options.labels if available
  if (input.options?.labels) {
    input.options.labels.forEach((label: string, index: number) => {
      choices.push({
        id: `choice_${index}`,
        content: label,
      });
    });
  }

  // Extract from items if available (for dynamic choices)
  if (input.items) {
    input.items.forEach((item: any, index: number) => {
      choices.push({
        id: item.id || `item_${index}`,
        content: item.content || item.title || item.label || "",
      });
    });
  }

  return choices;
}

/**
 * Creates buttons for WhatsApp from Typebot choices
 */
export function createWhatsAppButtons(
  choices: Array<{ id: string; content: string }>
): Array<{ id: string; title: string }> {
  return choices.slice(0, 3).map((choice) => ({
    id: choice.id,
    title: choice.content.substring(0, 20), // WhatsApp button title limit
  }));
}

/**
 * Creates list sections for WhatsApp from Typebot choices
 */
export function createWhatsAppList(
  choices: Array<{ id: string; content: string }>,
  sectionTitle = "Options"
): Array<{
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}> {
  return [
    {
      title: sectionTitle,
      rows: choices.map((choice) => ({
        id: choice.id,
        title: choice.content.substring(0, 24), // WhatsApp list title limit
        description:
          choice.content.length > 24 ? choice.content.substring(24, 96) : undefined,
      })),
    },
  ];
}

/**
 * Makes an authenticated API call to Typebot
 */
async function makeApiCall<T>(endpoint: string, options: RequestInit): Promise<T> {
  return withRetry(
    async () => {
      const response = await fetch(endpoint, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${typebot.apiKey}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Typebot API error: ${response.status} ${response.statusText}`;

        try {
          const errorJson: TypebotApiError = JSON.parse(errorText);
          errorMessage += ` - ${errorJson.error.message}`;
        } catch {
          errorMessage += ` - ${errorText}`;
        }

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        throw error;
      }

      const data = await response.json();

      return data as T;
    },
    { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 },
    { operation: "typebot_api_call" }
  );
}

/**
 * Validates if a session ID is in the correct format
 */
export function isValidSessionId(sessionId: string): boolean {
  // Typebot session IDs are typically UUIDs or similar format
  return typeof sessionId === "string" && sessionId.length > 0;
}

/**
 * Extracts typebot ID from a redirect URL
 */
export function extractTypebotIdFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Pattern 1: /typebot-id format (direct typebot redirect)
    const pathSegments = urlObj.pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    if (pathSegments.length === 1) {
      return pathSegments[0];
    }

    // Pattern 2: /typebots/typebot-id format
    if (pathSegments.length >= 2 && pathSegments[0] === "typebots") {
      return pathSegments[1];
    }

    // Pattern 3: typebot ID in query parameters
    const typebotId =
      urlObj.searchParams.get("t") ||
      urlObj.searchParams.get("typebot") ||
      urlObj.searchParams.get("id");
    if (typebotId) {
      return typebotId;
    }

    return null;
  } catch (error) {
    appLogger.warn(
      { url, error: error instanceof Error ? error.message : String(error) },
      "Failed to parse redirect URL"
    );
    return null;
  }
}

/**
 * Handles typebot redirect by updating the session with the new typebot
 */
export async function handleTypebotRedirect(
  prisma: PrismaClient,
  redirect: TypebotRedirect,
  sessionId: string,
  waId?: string
): Promise<ServiceResponse<any>> {
  const context = {
    waId,
    sessionId,
    redirectUrl: redirect.url,
    operation: "handle_typebot_redirect",
  };

  appLogger.debug(context, "Handling typebot redirect");

  const newTypebotSlug = extractTypebotIdFromUrl(redirect.url);
  if (!newTypebotSlug) {
    const error = `Could not extract typebot slug from redirect URL: ${redirect.url}`;
    appLogger.error(context, error);
    return {
      success: false,
      error: error,
      code: "INVALID_REDIRECT_URL",
    };
  }

  appLogger.debug(
    { ...context, newTypebotSlug },
    "Extracted typebot slug from redirect URL"
  );

  // Update the typebot in the session
  const updateResult = await updateTypebotInSession(sessionId, newTypebotSlug, waId);
  if (!updateResult.success) {
    appLogger.error(
      context,
      `Failed to update typebot in session: ${updateResult.error}`
    );
    return updateResult;
  }

  // Persist the active typebot slug in database for future interactions
  if (waId) {
    const setResult = await setActiveTypebotId(prisma, waId, newTypebotSlug, sessionId);
    if (!setResult.success) {
      appLogger.error(context, `Failed to persist new typebot slug: ${setResult.error}`);
    } else {
      appLogger.info(
        { ...context, newTypebotSlug },
        "Persisted new active typebot slug after successful redirect"
      );
    }
  }

  appLogger.debug(
    { ...context, newTypebotSlug },
    "Successfully updated typebot in session"
  );
  return updateResult;
}
