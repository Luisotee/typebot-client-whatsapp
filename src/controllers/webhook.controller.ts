import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  WhatsAppWebhookPayload,
  WhatsAppMessage
} from "../types/whatsapp.types";
import { ProcessedMessage, MessageContentType } from "../types/common.types";
import { config } from "../config/config";
import { appLogger } from "../utils/logger";
import { sanitizeText, isValidWhatsAppId } from "../utils/validation";
import { processMessage, getActiveSessionsCountForProcessing } from "../services/message-processing.service";
import { getActiveSessionId } from "../services/session.service";
import { convertBaileysToWhatsAppMessage, convertToProcessedMessage, extractTextFromInteractive } from "../utils/message-converter";
import { getBaileysSocket } from "../services/unified-whatsapp.service";
import { WAMessage } from '@whiskeysockets/baileys';

/**
 * Handles webhook verification (GET request)
 */
export async function verifyWebhook(req: Request, res: Response): Promise<void> {
  const context = { operation: 'webhook_verification' };
  appLogger.info({ ...context, query: req.query }, "Webhook verification request received");

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // For Baileys mode, verification is not needed
  if (config.whatsapp.mode === 'baileys') {
    appLogger.info(context, "✅ Baileys mode - webhook verification skipped");
    res.status(200).send(challenge || 'OK');
    return;
  }

  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    appLogger.info(context, "✅ Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    appLogger.warn({ ...context, receivedToken: token }, "❌ Webhook verification failed");
    res.sendStatus(403);
  }
}

/**
 * Handles incoming webhook messages (POST request)
 */
export async function handleWebhook(prisma: PrismaClient, req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const context = { operation: 'webhook_message', mode: config.whatsapp.mode };

  try {
    // Respond immediately to WhatsApp
    res.status(200).json({ status: "received" });

    // Handle Baileys mode differently - messages come via events, not HTTP webhooks
    if (config.whatsapp.mode === 'baileys') {
      appLogger.debug(context, "Baileys mode - webhook called but messages handled via events");
      return;
    }

    // Meta API webhook handling
    const payload: WhatsAppWebhookPayload = req.body;

    if (!isValidWebhookPayload(payload)) {
      appLogger.warn({ ...context, payload }, "Invalid webhook payload received");
      return;
    }

    const entry = payload.entry?.[0];
    if (!entry?.changes?.[0]?.value?.messages?.[0]) {
      appLogger.debug(context, "No messages in webhook payload");
      return;
    }

    const whatsappMessage = entry.changes[0].value.messages[0];
    const contact = entry.changes[0].value.contacts?.[0];

    const processedMessage = await processWhatsAppMessage(prisma, whatsappMessage, contact);

    if (processedMessage) {
      appLogger.webhookReceived({
        ...context,
        waId: processedMessage.waId,
        messageId: processedMessage.id,
        messageType: processedMessage.type,
        contactName: contact?.profile.name
      });

      // Process message asynchronously
      processMessage(prisma, processedMessage)
        .catch(error => {
          appLogger.error(
            { waId: processedMessage.waId, messageId: processedMessage.id },
            'Error processing message',
            error
          );
        });
    }

    const duration = Date.now() - startTime;
    appLogger.performance({ ...context, duration, operation: 'webhook_processing' });

  } catch (error) {
    const duration = Date.now() - startTime;
    appLogger.error(
      { ...context, duration, error },
      'Error handling webhook',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Validates webhook payload structure
 */
function isValidWebhookPayload(payload: any): payload is WhatsAppWebhookPayload {
  return (
    payload &&
    typeof payload === 'object' &&
    payload.object === 'whatsapp_business_account' &&
    Array.isArray(payload.entry)
  );
}

/**
 * Handles Baileys message events directly
 * This is called from the Baileys event handler, not HTTP webhook
 */
export async function handleBaileysMessage(prisma: PrismaClient, baileysMessage: WAMessage): Promise<void> {
  const startTime = Date.now();
  const context = { operation: 'baileys_message', messageId: baileysMessage.key.id || undefined };

  try {
    // Convert Baileys message to unified format
    const whatsappMessage = convertBaileysToWhatsAppMessage(baileysMessage);

    if (!whatsappMessage) {
      appLogger.warn({ ...context }, "Failed to convert Baileys message");
      return;
    }

    // Check if this is a text message that might be a numbered response to button/list fallback
    const numberedResponse = extractTextFromInteractive(whatsappMessage);
    if (numberedResponse) {
      appLogger.info({ ...context, response: numberedResponse }, "Detected numbered response for interactive fallback");
      // You could enhance this to map numbered responses back to original button/list options
    }

    const processedMessage = convertToProcessedMessage(whatsappMessage);

    if (processedMessage) {
      appLogger.webhookReceived({
        ...context,
        waId: processedMessage.waId,
        messageId: processedMessage.id,
        messageType: processedMessage.type,
        source: 'baileys'
      });

      // Process message asynchronously
      processMessage(prisma, processedMessage)
        .catch(error => {
          appLogger.error(
            { waId: processedMessage.waId, messageId: processedMessage.id },
            'Error processing Baileys message',
            error
          );
        });
    }

    const duration = Date.now() - startTime;
    appLogger.performance({ ...context, duration, operation: 'baileys_message_processing' });

  } catch (error) {
    const duration = Date.now() - startTime;
    appLogger.error(
      { ...context, duration, error },
      'Error handling Baileys message',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Processes WhatsApp message into internal format
 */
async function processWhatsAppMessage(
  prisma: PrismaClient,
  message: WhatsAppMessage,
  contact?: any
): Promise<ProcessedMessage | null> {
  const waId = message.from;
  const context = { waId, messageId: message.id, operation: 'process_whatsapp_message' };

  if (!isValidWhatsAppId(waId)) {
    appLogger.warn({ ...context }, "Invalid WhatsApp ID format");
    return null;
  }

  try {
    const processedMessage: ProcessedMessage = {
      id: message.id,
      waId,
      content: '',
      type: getMessageContentType(message),
      timestamp: new Date(parseInt(message.timestamp) * 1000),
    };

    // Extract content based on message type
    switch (message.type) {
      case 'text':
        processedMessage.content = sanitizeText(message.text?.body || '');

        // Check if this might be a numbered response for Baileys fallback
        if (config.whatsapp.mode === 'baileys') {
          const numberedResponse = extractTextFromInteractive(message);
          if (numberedResponse) {
            appLogger.info({ ...context, response: numberedResponse }, "Text message might be numbered interactive response");
            processedMessage.sessionId = await getActiveSessionId(prisma, waId) || undefined;
          }
        }
        break;

      case 'audio':
        processedMessage.content = '[Audio Message]';
        processedMessage.mediaUrl = message.audio?.id;
        break;

      case 'image':
        processedMessage.content = sanitizeText(message.image?.caption || '[Image]');
        processedMessage.mediaUrl = message.image?.id;
        break;

      case 'video':
        processedMessage.content = sanitizeText(message.video?.caption || '[Video]');
        processedMessage.mediaUrl = message.video?.id;
        break;

      case 'document':
        processedMessage.content = '[Document]';
        processedMessage.mediaUrl = message.document?.id;
        break;

      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          processedMessage.content = sanitizeText(message.interactive.button_reply?.title || '');
          processedMessage.type = 'button';
          processedMessage.sessionId = await getActiveSessionId(prisma, waId) || undefined;
        } else if (message.interactive?.type === 'list_reply') {
          processedMessage.content = sanitizeText(message.interactive.list_reply?.title || '');
          processedMessage.type = 'interactive';
          processedMessage.sessionId = await getActiveSessionId(prisma, waId) || undefined;
        } else if (message.interactive?.type === 'text_reply') {
          // Baileys fallback handling
          processedMessage.content = sanitizeText(message.interactive.text_reply?.text || '');
          processedMessage.type = 'interactive';
          processedMessage.sessionId = await getActiveSessionId(prisma, waId) || undefined;
        }
        break;

      case 'button':
        processedMessage.content = sanitizeText(message.button?.text || '');
        processedMessage.type = 'button';
        processedMessage.sessionId = await getActiveSessionId(prisma, waId) || undefined;
        break;

      default:
        appLogger.warn({ ...context, messageType: message.type },
          `Unsupported message type: ${message.type}`);
        return null;
    }

    if (!processedMessage.content && !processedMessage.mediaUrl) {
      appLogger.warn({ ...context }, "Message has no content or media");
      return null;
    }

    appLogger.debug({ ...context, type: processedMessage.type, hasMedia: !!processedMessage.mediaUrl },
      "WhatsApp message processed successfully");

    return processedMessage;

  } catch (error) {
    appLogger.error({ ...context }, 'Error processing WhatsApp message',
      error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Determines content type from WhatsApp message
 */
function getMessageContentType(message: WhatsAppMessage): MessageContentType {
  switch (message.type) {
    case 'text':
      return 'text';
    case 'audio':
      return 'audio';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'interactive':
      return 'interactive';
    case 'button':
      return 'button';
    default:
      return 'text'; // Fallback
  }
}

/**
 * Health check endpoint
 */
export async function healthCheck(req: Request, res: Response): Promise<void> {
  const activeSessionsCount = getActiveSessionsCountForProcessing();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeSessions: activeSessionsCount,
    uptime: process.uptime()
  });
}