import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import express from "express";
import pino from "pino";
import {
  BOT_LANGUAGE,
  DONE_REACTION,
  ERROR_REACTION,
  QUEUED_REACTION,
  TRANSCRIPTION_ENABLED,
  TYPEBOT_API_KEY,
  TYPEBOT_API_URL,
  TYPEBOT_SESSION_URL,
  VERIFY_TOKEN,
  WORKING_REACTION,
} from "./config";
import {
  sendWhatsappReaction,
  sendWhatsappText,
  sendWhatsappVideo,
  sendWhatsappButtons,
  sendWhatsappList,
} from "./whatsappApi";
import { transcribeAudio } from "./transcriptionService";
import { downloadWhatsAppMedia } from "./mediaUtils";
import { getMessage } from "./localization";
import { matchTranscriptionToOption } from "./optionMatcher";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

// Store active choice sessions temporarily
const activeChoiceSessions = new Map<
  string,
  {
    sessionId: string;
    choices: Array<{ id: string; content: string }>;
    timestamp: Date;
  }
>();

// Clean up old choice sessions every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  for (const [waId, session] of activeChoiceSessions.entries()) {
    if (session.timestamp < fiveMinutesAgo) {
      activeChoiceSessions.delete(waId);
    }
  }
}, 5 * 60 * 1000);

// Webhook verification
app.get("/webhook", (req, res) => {
  logger.info({ query: req.query }, "Received webhook verification request");
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    logger.warn("Webhook verification failed");
    res.sendStatus(403);
  }
});

// Webhook for incoming messages
app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const messages = changes?.value?.messages;
  if (messages && messages.length > 0) {
    const msg = messages[0];
    const waId = msg.from;
    let text = msg.text?.body;

    // Handle interactive message responses (button/list selections)
    if (msg.interactive) {
      if (msg.interactive.type === "button_reply") {
        text = msg.interactive.button_reply.title;
      } else if (msg.interactive.type === "list_reply") {
        text = msg.interactive.list_reply.title;
      }
      // Clear the active choice session since user used UI
      activeChoiceSessions.delete(waId);
    }

    // Handle audio messages
    if (msg.audio) {
      const messageId = msg.id;

      if (!TRANSCRIPTION_ENABLED) {
        logger.info(
          { waId, audioId: msg.audio.id },
          "Received audio message but transcription is disabled"
        );

        if (messageId) await sendWhatsappReaction(waId, messageId, ERROR_REACTION);
        await sendWhatsappText(waId, getMessage("transcriptionDisabled", BOT_LANGUAGE));
        res.sendStatus(200);
        return;
      }

      logger.info({ waId, audioId: msg.audio.id }, "Received audio message");

      if (messageId) await sendWhatsappReaction(waId, messageId, QUEUED_REACTION);

      try {
        if (messageId) await sendWhatsappReaction(waId, messageId, WORKING_REACTION);

        // Download audio file
        const mediaResult = await downloadWhatsAppMedia(msg.audio.id);
        if (!mediaResult.success) {
          throw new Error(`Failed to download audio: ${mediaResult.error}`);
        }

        // Transcribe audio
        const transcriptionResult = await transcribeAudio(
          mediaResult.buffer,
          mediaResult.mimeType
        );
        if (!transcriptionResult.success) {
          throw new Error(`Failed to transcribe audio: ${transcriptionResult.error}`);
        }

        text = transcriptionResult.text;
        logger.info({ waId, transcription: text }, "Audio transcribed successfully");

        // Check if this user has an active choice session
        const activeChoice = activeChoiceSessions.get(waId);
        if (activeChoice && text) {
          logger.info(
            { waId, transcription: text, choices: activeChoice.choices },
            "Attempting to match audio to choice options"
          );

          const matchResult = matchTranscriptionToOption(text, activeChoice.choices);

          if (matchResult.matched && matchResult.selectedOption) {
            logger.info(
              {
                waId,
                transcription: text,
                matchedOption: matchResult.selectedOption.content,
                confidence: matchResult.confidence,
              },
              "Successfully matched audio to choice option"
            );

            // Send confirmation message
            await sendWhatsappText(
              waId,
              getMessage("audioOptionMatched", BOT_LANGUAGE, {
                option: matchResult.selectedOption.content,
              })
            );

            // Use the matched option as the user's choice
            text = matchResult.selectedOption.content;

            // Clear the active choice session
            activeChoiceSessions.delete(waId);
          } else {
            logger.info(
              {
                waId,
                transcription: text,
                confidence: matchResult.confidence,
                availableOptions: activeChoice.choices.map((c) => c.content),
              },
              "Could not match audio to any choice option"
            );

            if (messageId) await sendWhatsappReaction(waId, messageId, ERROR_REACTION);
            await sendWhatsappText(
              waId,
              getMessage("audioOptionNotMatched", BOT_LANGUAGE)
            );
            res.sendStatus(200);
            return;
          }
        }
      } catch (error) {
        logger.error({ error }, "Error processing audio message");
        if (messageId) await sendWhatsappReaction(waId, messageId, ERROR_REACTION);
        await sendWhatsappText(waId, getMessage("audioProcessingError", BOT_LANGUAGE));
        res.sendStatus(200);
        return;
      }
    }

    const messageId = msg.id;
    //logger.info({ waId, text }, "Incoming WhatsApp message");

    if (messageId && !msg.audio)
      await sendWhatsappReaction(waId, messageId, QUEUED_REACTION);

    try {
      if (messageId && !msg.audio)
        await sendWhatsappReaction(waId, messageId, WORKING_REACTION);

      if (text) {
        // Find or create user
        let user = await prisma.user.findUnique({ where: { waId } });
        if (!user) {
          user = await prisma.user.create({ data: { waId } });
          logger.info({ waId, userId: user.id }, "Created new user");
        }

        // Create incoming message
        await prisma.message.create({
          data: {
            userId: user.id,
            content: msg.audio ? `[Audio transcribed]: ${text}` : text,
            direction: "in",
          },
        });

        // Example: Send video for specific keywords
        if (text.toLowerCase().includes("video") || text.toLowerCase().includes("demo")) {
          const videoUrl = "https://example.com/your-video.mp4";
          const caption = "Here's the video you requested!";

          logger.info(
            { waId, videoUrl, caption },
            "Sending video in response to keyword"
          );
          await sendWhatsappVideo(waId, videoUrl, caption);

          await prisma.message.create({
            data: {
              userId: user.id,
              content: `[Video sent: ${videoUrl}]`,
              direction: "out",
              sessionId: null,
            },
          });
        }

        // --- Typebot session logic ---
        // Get the latest message with sessionId for this user
        const lastMsg = await prisma.message.findFirst({
          where: { userId: user.id, sessionId: { not: null } },
          orderBy: { timestamp: "desc" },
        });

        let sessionId: string | null = null;
        let typebotResponse: any;
        let needNewSession = false;

        if (lastMsg && lastMsg.sessionId) {
          sessionId = lastMsg.sessionId;
          logger.info(
            { waId, sessionId, userId: user.id },
            "Continuing existing Typebot session"
          );
          const continueRes = await fetch(
            `${TYPEBOT_SESSION_URL}/${sessionId}/continueChat`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${TYPEBOT_API_KEY}`,
              },
              body: JSON.stringify({ message: text }),
            }
          );
          typebotResponse = await continueRes.json();
          if (continueRes.status === 404 || typebotResponse.code === "NOT_FOUND") {
            logger.info(
              { waId, sessionId, userId: user.id },
              "Typebot session not found, starting new"
            );
            needNewSession = true;
          }
        } else {
          logger.info(
            { waId, userId: user.id },
            "No previous session, starting new Typebot session"
          );
          needNewSession = true;
        }

        if (needNewSession) {
          const res = await fetch(TYPEBOT_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${TYPEBOT_API_KEY}`,
            },
            body: JSON.stringify({ message: text }),
          });
          typebotResponse = await res.json();
          sessionId = typebotResponse.sessionId;
          logger.info(
            { waId, sessionId, userId: user.id },
            "Started new Typebot session"
          );
        }

        // Update the latest incoming message with the sessionId
        await prisma.message.updateMany({
          where: {
            userId: user.id,
            content: msg.audio ? `[Audio transcribed]: ${text}` : text,
            direction: "in",
            sessionId: null,
          },
          data: { sessionId },
        });

        logger.info({ typebotResponse }, "Full Typebot response");

        // Process Typebot messages
        let lastTextMessage: any = null;
        let textMessages: any[] = [];
        if (
          Array.isArray(typebotResponse.messages) &&
          typebotResponse.messages.length > 0
        ) {
          logger.info(
            { typebotMessages: typebotResponse.messages },
            "Typebot messages array"
          );
          textMessages = typebotResponse.messages.filter((m: any) => m.type === "text");
          lastTextMessage = textMessages[textMessages.length - 1];
        }

        // Handle choice input (buttons/list)
        if (typebotResponse.input?.type === "choice input") {
          // Send all text messages except the last one
          for (const message of textMessages.slice(0, -1)) {
            let reply = "";
            if (message.content?.richText) {
              reply = message.content.richText.map(extractTextFromRichText).join("");
            } else if (message.content?.text) {
              reply = message.content.text;
            } else if (message.content?.plainText) {
              reply = message.content.plainText;
            } else if (message.content?.html) {
              reply = message.content.html;
            } else if (typeof message.content === "string") {
              reply = message.content;
            } else {
              reply = JSON.stringify(message.content);
            }
            logger.info({ waId, reply, message }, "Sending WhatsApp text reply");
            await prisma.message.create({
              data: {
                userId: user.id,
                content: reply,
                direction: "out",
                sessionId,
              },
            });
            await sendWhatsappText(waId, reply);
          }

          // Use the last text message as the body for buttons/list
          const bodyText = lastTextMessage
            ? lastTextMessage.content?.richText
              ? lastTextMessage.content.richText.map(extractTextFromRichText).join("")
              : getMessage("chooseOption", BOT_LANGUAGE)
            : getMessage("chooseOption", BOT_LANGUAGE);

          const choices = typebotResponse.input.items || [];

          // Store the active choice session for audio matching
          if (sessionId && choices.length > 0) {
            activeChoiceSessions.set(waId, {
              sessionId,
              choices: choices.map((choice: any) => ({
                id: choice.id,
                content: choice.content,
              })),
              timestamp: new Date(),
            });
            logger.info(
              { waId, sessionId, choicesCount: choices.length },
              "Stored active choice session for audio matching"
            );
          }

          if (choices.length <= 3) {
            const buttons = choices.map((choice: any) => ({
              id: choice.id,
              title: choice.content.substring(0, 20),
            }));

            logger.info({ waId, buttons }, "Sending WhatsApp buttons");
            await sendWhatsappButtons(waId, bodyText, buttons);

            await prisma.message.create({
              data: {
                userId: user.id,
                content: `[Buttons: ${choices.map((c: any) => c.content).join(", ")}]`,
                direction: "out",
                sessionId,
              },
            });
          } else {
            const rows = choices.map((choice: any) => ({
              id: choice.id,
              title: choice.content.substring(0, 24),
              description:
                choice.content.length > 24 ? choice.content.substring(0, 72) : undefined,
            }));

            logger.info({ waId, rows }, "Sending WhatsApp list");
            await sendWhatsappList(
              waId,
              bodyText,
              getMessage("listSectionTitle", BOT_LANGUAGE),
              [
                {
                  title: getMessage("listSectionTitle", BOT_LANGUAGE),
                  rows,
                },
              ]
            );

            await prisma.message.create({
              data: {
                userId: user.id,
                content: `[List: ${choices.map((c: any) => c.content).join(", ")}]`,
                direction: "out",
                sessionId,
              },
            });
          }
        } else {
          // Clear any active choice session since there's no choice input
          activeChoiceSessions.delete(waId);

          // If there is no choice input, send all text messages as WhatsApp text
          for (const message of typebotResponse.messages || []) {
            if (message.type === "text") {
              let reply = "";
              if (message.content?.richText) {
                reply = message.content.richText.map(extractTextFromRichText).join("");
              } else if (message.content?.text) {
                reply = message.content.text;
              } else if (message.content?.plainText) {
                reply = message.content.plainText;
              } else if (message.content?.html) {
                reply = message.content.html;
              } else if (typeof message.content === "string") {
                reply = message.content;
              } else {
                reply = JSON.stringify(message.content);
              }
              logger.info({ waId, reply, message }, "Sending WhatsApp text reply");
              await prisma.message.create({
                data: {
                  userId: user.id,
                  content: reply,
                  direction: "out",
                  sessionId,
                },
              });
              await sendWhatsappText(waId, reply);
            } else if (message.type === "video") {
              // Handle video messages from Typebot
              const videoUrl = message.content?.url || message.content?.link;
              const caption = message.content?.caption;

              if (videoUrl) {
                logger.info({ waId, videoUrl, caption }, "Sending WhatsApp video");
                await sendWhatsappVideo(waId, videoUrl, caption);

                await prisma.message.create({
                  data: {
                    userId: user.id,
                    content: `[Video: ${videoUrl}]${caption ? ` - ${caption}` : ""}`,
                    direction: "out",
                    sessionId,
                  },
                });
              }
            }
          }
        }
      }

      if (messageId) await sendWhatsappReaction(waId, messageId, DONE_REACTION);
    } catch (error) {
      logger.error({ error }, "Error processing WhatsApp message");
      if (messageId) await sendWhatsappReaction(waId, messageId, ERROR_REACTION);
      await sendWhatsappText(waId, getMessage("generalError", BOT_LANGUAGE));
    }
  }
  res.sendStatus(200);
});

// Helper to recursively extract all text from richText nodes
function extractTextFromRichText(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.children)) {
    return node.children.map(extractTextFromRichText).join("");
  }
  return "";
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
