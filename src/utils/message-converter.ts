import { WAMessage, getContentType } from '@whiskeysockets/baileys';
import { WhatsAppMessage, WhatsAppMessageType } from '../types/whatsapp.types';
import { BaileysIncomingMessage } from '../types/baileys.types';
import { ProcessedMessage } from '../types/common.types';
import { appLogger } from './logger';

/**
 * Converts a Baileys WAMessage to our unified WhatsAppMessage format
 */
export function convertBaileysToWhatsAppMessage(baileysMessage: WAMessage): WhatsAppMessage | null {
  try {
    if (!baileysMessage.key.id || !baileysMessage.key.remoteJid) {
      appLogger.warn({ messageKey: baileysMessage.key }, 'Invalid Baileys message: missing required fields');
      return null;
    }

    const messageType = getContentType(baileysMessage.message);
    if (!messageType) {
      appLogger.warn({ messageKey: baileysMessage.key }, 'Invalid Baileys message: no content type');
      return null;
    }

    const whatsappMessage: WhatsAppMessage = {
      id: baileysMessage.key.id || '',
      from: (baileysMessage.key.remoteJid || '').replace('@s.whatsapp.net', ''),
      timestamp: (baileysMessage.messageTimestamp as number || Date.now()).toString(),
      type: mapBaileysTypeToWhatsAppType(messageType),
      baileys: {
        rawMessage: baileysMessage,
        messageTimestamp: baileysMessage.messageTimestamp as number
      }
    };

    // Extract content based on message type
    const message = baileysMessage.message;
    if (!message) return whatsappMessage;

    switch (messageType) {
      case 'conversation':
        whatsappMessage.text = { body: message.conversation || '' };
        break;

      case 'extendedTextMessage':
        whatsappMessage.text = { body: message.extendedTextMessage?.text || '' };
        break;

      case 'imageMessage':
        whatsappMessage.image = {
          id: message.imageMessage?.url || '',
          mime_type: message.imageMessage?.mimetype || 'image/jpeg',
          sha256: message.imageMessage?.fileSha256?.toString() || '',
          caption: message.imageMessage?.caption
        };
        break;

      case 'videoMessage':
        whatsappMessage.video = {
          id: message.videoMessage?.url || '',
          mime_type: message.videoMessage?.mimetype || 'video/mp4',
          sha256: message.videoMessage?.fileSha256?.toString() || '',
          caption: message.videoMessage?.caption
        };
        break;

      case 'audioMessage':
        whatsappMessage.audio = {
          id: message.audioMessage?.url || '',
          mime_type: message.audioMessage?.mimetype || 'audio/ogg',
          sha256: message.audioMessage?.fileSha256?.toString() || ''
        };
        break;

      case 'documentMessage':
        whatsappMessage.document = {
          id: message.documentMessage?.url || '',
          mime_type: message.documentMessage?.mimetype || 'application/octet-stream',
          sha256: message.documentMessage?.fileSha256?.toString() || '',
          caption: message.documentMessage?.caption
        };
        break;

      default:
        appLogger.info({ messageType, messageKey: baileysMessage.key }, 'Unsupported Baileys message type');
    }

    // Handle quoted messages
    if (message.extendedTextMessage?.contextInfo?.quotedMessage) {
      whatsappMessage.context = {
        from: message.extendedTextMessage.contextInfo.participant || '',
        id: message.extendedTextMessage.contextInfo.stanzaId || ''
      };
    }

    return whatsappMessage;

  } catch (error) {
    appLogger.error({ error, messageKey: baileysMessage.key }, 'Failed to convert Baileys message');
    return null;
  }
}

/**
 * Maps Baileys message type to WhatsApp message type
 */
function mapBaileysTypeToWhatsAppType(baileysType: string): WhatsAppMessageType {
  switch (baileysType) {
    case 'conversation':
    case 'extendedTextMessage':
      return 'text';
    case 'imageMessage':
      return 'image';
    case 'videoMessage':
      return 'video';
    case 'audioMessage':
      return 'audio';
    case 'documentMessage':
      return 'document';
    case 'reactionMessage':
      return 'reaction';
    default:
      return 'text'; // Default fallback
  }
}

/**
 * Converts a unified WhatsAppMessage to ProcessedMessage
 */
export function convertToProcessedMessage(
  whatsappMessage: WhatsAppMessage,
  sessionId?: string
): ProcessedMessage {
  let content = '';
  let mediaUrl: string | undefined;

  // Extract content based on message type
  if (whatsappMessage.text) {
    content = whatsappMessage.text.body;
  } else if (whatsappMessage.image) {
    content = whatsappMessage.image.caption || '[Image]';
    mediaUrl = whatsappMessage.image.id;
  } else if (whatsappMessage.video) {
    content = whatsappMessage.video.caption || '[Video]';
    mediaUrl = whatsappMessage.video.id;
  } else if (whatsappMessage.audio) {
    content = '[Audio]';
    mediaUrl = whatsappMessage.audio.id;
  } else if (whatsappMessage.document) {
    content = whatsappMessage.document.caption || '[Document]';
    mediaUrl = whatsappMessage.document.id;
  } else if (whatsappMessage.interactive) {
    if (whatsappMessage.interactive.button_reply) {
      content = whatsappMessage.interactive.button_reply.title;
    } else if (whatsappMessage.interactive.list_reply) {
      content = whatsappMessage.interactive.list_reply.title;
    } else if (whatsappMessage.interactive.text_reply) {
      content = whatsappMessage.interactive.text_reply.text;
    }
  }

  return {
    id: whatsappMessage.id,
    waId: whatsappMessage.from,
    content,
    type: mapWhatsAppTypeToProcessedType(whatsappMessage.type),
    timestamp: new Date(parseInt(whatsappMessage.timestamp) * 1000),
    sessionId,
    mediaUrl
  };
}

/**
 * Maps WhatsApp message type to ProcessedMessage type
 */
function mapWhatsAppTypeToProcessedType(type: WhatsAppMessageType): 'text' | 'audio' | 'image' | 'video' | 'interactive' | 'button' | 'document' {
  switch (type) {
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
      return 'text';
  }
}

/**
 * Extracts text content from interactive messages (for numbered choice handling)
 */
export function extractTextFromInteractive(whatsappMessage: WhatsAppMessage): string | null {
  if (whatsappMessage.type !== 'text' || !whatsappMessage.text) {
    return null;
  }

  const text = whatsappMessage.text.body.trim();

  // Check if it's a numbered response (1, 2, 3, etc.)
  const numberMatch = text.match(/^(\d+)\.?$/);
  if (numberMatch) {
    return text;
  }

  return null;
}

/**
 * Checks if a message is from Baileys mode
 */
export function isBaileysMessage(message: any): message is WAMessage {
  return message && message.key && message.key.remoteJid && message.message;
}

/**
 * Gets message content type from Baileys message
 */
export function getBaileysMessageType(message: WAMessage): string | null {
  return getContentType(message.message) || null;
}