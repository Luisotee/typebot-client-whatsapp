import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import express from "express";
import pino from "pino";
import {
  DONE_REACTION,
  ERROR_REACTION,
  QUEUED_REACTION,
  TYPEBOT_API_KEY,
  TYPEBOT_API_URL,
  TYPEBOT_SESSION_URL,
  VERIFY_TOKEN,
  WORKING_REACTION,
} from "./config";
import { sendWhatsappReaction, sendWhatsappText, sendWhatsappVideo } from "./whatsappApi";

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
    const text = msg.text?.body;
    const messageId = msg.id;
    logger.info({ waId, text }, "Incoming WhatsApp message");

    if (messageId) await sendWhatsappReaction(waId, messageId, QUEUED_REACTION);

    try {
      if (messageId) await sendWhatsappReaction(waId, messageId, WORKING_REACTION);

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
            content: text,
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
            content: text,
            direction: "in",
            sessionId: null,
          },
          data: { sessionId },
        });

        logger.info({ typebotResponse }, "Full Typebot response");

        if (
          Array.isArray(typebotResponse.messages) &&
          typebotResponse.messages.length > 0
        ) {
          logger.info(
            { typebotMessages: typebotResponse.messages },
            "Typebot messages array"
          );
          for (const message of typebotResponse.messages) {
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
              const videoUrl = message.content?.url;
              if (videoUrl) {
                logger.info({ waId, videoUrl }, "Sending WhatsApp video");
                await prisma.message.create({
                  data: {
                    userId: user.id,
                    content: `[Video: ${videoUrl}]`,
                    direction: "out",
                    sessionId,
                  },
                });
                await sendWhatsappVideo(waId, videoUrl);
              }
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
