import { WAMessage, getContentType } from '@whiskeysockets/baileys';
import { WhatsAppMessage, WhatsAppMessageType } from '../types/whatsapp.types';
import { ProcessedMessage } from '../types/common.types';
import { appLogger } from './logger';

/**
 * Extracts phone number from Baileys WAMessage, handling both @lid and @s.whatsapp.net formats
 */
function extractPhoneNumber(baileysMessage: WAMessage): string {
  const remoteJid = baileysMessage.key.remoteJid || '';
  const isLid = remoteJid.includes('@lid');

  // If it's a LID, try to extract the real phone number from alternative fields
  if (isLid) {
    const messageObj = baileysMessage as any;
    const key = baileysMessage.key as any;

    appLogger.debug({
      remoteJid,
      remoteJidAlt: key.remoteJidAlt,
      participantAlt: key.participantAlt,
      participant: key.participant,
      pushName: messageObj.pushName,
      keyKeys: Object.keys(baileysMessage.key)
    }, '🔍 LID detected, attempting to extract real phone number');

    // Try to extract from various fields in priority order:

    // 1. Check for remoteJidAlt field - Baileys populates this with the real phone number when primary JID is LID
    const remoteJidAlt = key.remoteJidAlt;
    if (remoteJidAlt && typeof remoteJidAlt === 'string') {
      // remoteJidAlt should be in format like "5515988203928@s.whatsapp.net"
      const phoneNumber = remoteJidAlt.replace(/@.*$/, '');
      if (phoneNumber && phoneNumber.length > 5 && !phoneNumber.includes('@lid')) {
        appLogger.info({
          lid: remoteJid.replace(/@.*$/, ''),
          phoneNumber,
          source: 'remoteJidAlt'
        }, '✅ Extracted phone number from remoteJidAlt field');
        return phoneNumber;
      }
    }

    // 2. Check for participantAlt field (alternative for group messages)
    const participantAlt = key.participantAlt;
    if (participantAlt && typeof participantAlt === 'string') {
      const phoneNumber = participantAlt.replace(/@.*$/, '');
      if (phoneNumber && phoneNumber.length > 5 && !phoneNumber.includes('@lid')) {
        appLogger.info({
          lid: remoteJid.replace(/@.*$/, ''),
          phoneNumber,
          source: 'participantAlt'
        }, '✅ Extracted phone number from participantAlt field');
        return phoneNumber;
      }
    }

    // 3. Check for participant field (in group messages, standard field)
    const participant = baileysMessage.key.participant;
    if (participant && !participant.includes('@lid')) {
      const phoneNumber = participant.replace(/@.*$/, '');
      if (phoneNumber && phoneNumber.length > 5) {
        appLogger.info({
          lid: remoteJid.replace(/@.*$/, ''),
          phoneNumber,
          source: 'participant'
        }, '✅ Extracted phone number from participant field');
        return phoneNumber;
      }
    }

    // 4. Log available fields for debugging - this will help identify other fields we can use
    appLogger.warn({
      lid: remoteJid.replace(/@.*$/, ''),
      pushName: messageObj.pushName,
      remoteJidAlt: key.remoteJidAlt,
      participantAlt: key.participantAlt,
      participant: key.participant,
      availableFields: Object.keys(baileysMessage).filter(k => k !== 'message' && k !== 'key'),
      keyFields: Object.keys(baileysMessage.key)
    }, '⚠️  Could not extract phone number from LID, using LID as fallback');

    // Fall back to LID if we can't extract phone number
    return remoteJid.replace(/@.*$/, '');
  }

  // Standard format: just strip the @s.whatsapp.net suffix
  return remoteJid.replace(/@.*$/, '');
}

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
      from: extractPhoneNumber(baileysMessage),
      timestamp: (baileysMessage.messageTimestamp as number || Date.now()).toString(),
      type: mapBaileysTypeToWhatsAppType(messageType),
      baileys: {
        rawMessage: baileysMessage,
        messageTimestamp: baileysMessage.messageTimestamp as number,
        remoteJid: baileysMessage.key.remoteJid // Store original JID for replies
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
  let baileysMessage: WAMessage | undefined;

  // Extract content based on message type
  if (whatsappMessage.text) {
    content = whatsappMessage.text.body;
  } else if (whatsappMessage.image) {
    content = whatsappMessage.image.caption || '[Image]';
    mediaUrl = whatsappMessage.image.id;
    // For Baileys image messages, store the raw message for download
    if (whatsappMessage.baileys?.rawMessage) {
      baileysMessage = whatsappMessage.baileys.rawMessage;
    }
  } else if (whatsappMessage.video) {
    content = whatsappMessage.video.caption || '[Video]';
    mediaUrl = whatsappMessage.video.id;
    // For Baileys video messages, store the raw message for download
    if (whatsappMessage.baileys?.rawMessage) {
      baileysMessage = whatsappMessage.baileys.rawMessage;
    }
  } else if (whatsappMessage.audio) {
    content = '[Audio]';
    mediaUrl = whatsappMessage.audio.id;
    // For Baileys audio messages, store the raw message for download
    if (whatsappMessage.baileys?.rawMessage) {
      baileysMessage = whatsappMessage.baileys.rawMessage;
    }
  } else if (whatsappMessage.document) {
    content = whatsappMessage.document.caption || '[Document]';
    mediaUrl = whatsappMessage.document.id;
    // For Baileys document messages, store the raw message for download
    if (whatsappMessage.baileys?.rawMessage) {
      baileysMessage = whatsappMessage.baileys.rawMessage;
    }
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
    mediaUrl,
    baileysMessage
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