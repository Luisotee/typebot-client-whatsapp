import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import express from "express";
import pino from "pino";
import {
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

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

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
        await sendWhatsappText(
          waId,
          "Sorry, I can't process audio messages at the moment. Please send your message as text instead."
        );
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
      } catch (error) {
        logger.error({ error }, "Error processing audio message");
        if (messageId) await sendWhatsappReaction(waId, messageId, ERROR_REACTION);
        await sendWhatsappText(
          waId,
          "Sorry, I couldn't process your audio message. Please try sending a text message."
        );
        res.sendStatus(200);
        return;
      }
    }

    const messageId = msg.id;
    logger.info({ waId, text }, "Incoming WhatsApp message");

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
              : "Escolha uma opção:"
            : "Escolha uma opção:";

          const choices = typebotResponse.input.items || [];
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
            await sendWhatsappList(waId, bodyText, "Opções", [
              {
                title: "Escolha uma opção",
                rows,
              },
            ]);

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
            }
          }
        }
      }

      if (messageId) await sendWhatsappReaction(waId, messageId, DONE_REACTION);
    } catch (error) {
      logger.error({ error }, "Error processing WhatsApp message");
      if (messageId) await sendWhatsappReaction(waId, messageId, ERROR_REACTION);
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
