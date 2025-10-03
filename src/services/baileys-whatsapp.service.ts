import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WAMessage,
  WASocket,
  proto,
  downloadMediaMessage,
  getContentType,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { ServiceResponse } from "../types/common.types";
import { appLogger } from "../utils/logger";
import { withServiceResponse, withRetry, sleep } from "../utils/retry";
import * as fs from 'fs';
import * as path from 'path';

// Global socket instance
let sock: WASocket | null = null;

// Simple in-memory message cache for getMessage functionality
const messageCache = new Map<string, proto.IWebMessageInfo>();

/**
 * Initializes Baileys WhatsApp client
 */
export async function initializeBaileySocket(): Promise<void> {
  try {
    appLogger.info({}, 'Step 1: Creating auth directory...');
    // Create auth directory if it doesn't exist
    const authDir = path.join(process.cwd(), 'auth_info_baileys');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
      appLogger.info({ authDir }, 'Created auth directory');
    } else {
      appLogger.info({ authDir }, 'Auth directory already exists');
    }

    appLogger.info({}, 'Step 2: Loading auth state...');
    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    appLogger.info({}, 'Auth state loaded successfully');

    appLogger.info({}, 'Step 3: Creating socket...');
    // Create socket
    sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('TypeBot WhatsApp Client'),
      printQRInTerminal: false, // We'll use qrcode-terminal instead
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => {
        // Return cached message if available
        const msgKey = `${key.remoteJid}_${key.id}`;
        const cachedMsg = messageCache.get(msgKey);
        return cachedMsg?.message || undefined;
      }
    });

    appLogger.info({}, '✅ Baileys socket created successfully');

    // Handle connection updates
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📱 Scan this QR code with WhatsApp to connect:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        qrcode.generate(qr, { small: true });
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        appLogger.info({}, '✅ QR Code generated successfully');
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        appLogger.info({
          error: lastDisconnect?.error,
          shouldReconnect
        }, 'Connection closed');

        if (shouldReconnect) {
          setTimeout(() => initializeBaileySocket(), 5000);
        }
      } else if (connection === 'open') {
        appLogger.info({}, 'WhatsApp connection opened successfully');
      }
    });

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Handle messages (this will be used by webhook controller)
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const message of messages) {
        // Cache message for getMessage functionality
        const msgKey = `${message.key.remoteJid}_${message.key.id}`;
        messageCache.set(msgKey, message);

        if (!message.key.fromMe) {
          appLogger.info({
            messageId: message.key.id,
            from: message.key.remoteJid,
            type: getContentType(message.message)
          }, 'Received message via Baileys');
        }
      }
    });

  } catch (error) {
    appLogger.error({
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    }, '❌ Failed to initialize Baileys socket');
    throw error;
  }
}

/**
 * Gets the current socket instance
 */
export function getSocket(): WASocket | null {
  return sock;
}

/**
 * Sends a text message via Baileys
 */
export async function sendTextMessage(to: string, text: string, waId?: string): Promise<ServiceResponse<any>> {
  const context = { waId, operation: 'send_text_message', recipient: to };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    const jid = formatJid(to);
    const response = await sock.sendMessage(jid, { text });

    appLogger.info({
      messageId: response?.key?.id,
      to: jid,
      text: text.substring(0, 100)
    }, 'Text message sent via Baileys');

    return response;
  }, context);
}

/**
 * Sends an image message via Baileys
 */
export async function sendImageMessage(to: string, imageUrl: string, caption?: string, waId?: string): Promise<ServiceResponse<any>> {
  const context = { waId, operation: 'send_image_message', recipient: to };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    const jid = formatJid(to);
    const response = await sock.sendMessage(jid, {
      image: { url: imageUrl },
      caption
    });

    appLogger.info({
      messageId: response?.key?.id,
      to: jid,
      imageUrl,
      caption
    }, 'Image message sent via Baileys');

    return response;
  }, context);
}

/**
 * Sends a video message via Baileys
 */
export async function sendVideoMessage(to: string, videoUrl: string, caption?: string, waId?: string): Promise<ServiceResponse<any>> {
  const context = { waId, operation: 'send_video_message', recipient: to };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    const jid = formatJid(to);
    const response = await sock.sendMessage(jid, {
      video: { url: videoUrl },
      caption
    });

    appLogger.info({
      messageId: response?.key?.id,
      to: jid,
      videoUrl,
      caption
    }, 'Video message sent via Baileys');

    return response;
  }, context);
}

/**
 * Sends interactive button message (fallback to text for Baileys)
 * Note: Baileys doesn't support interactive buttons like Meta API
 */
export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  waId?: string
): Promise<ServiceResponse<any>> {
  const context = { waId, operation: 'send_button_message', recipient: to };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    // Fallback: Convert buttons to numbered text options
    const buttonText = buttons.map((btn, index) => `${index + 1}. ${btn.title}`).join('\n');
    const fallbackText = `${bodyText}\n\n${buttonText}\n_Responda com o número da sua escolha_`;

    const jid = formatJid(to);
    const response = await sock.sendMessage(jid, { text: fallbackText });

    appLogger.info({
      messageId: response?.key?.id,
      to: jid,
      originalButtons: buttons,
      fallbackText
    }, 'Button message sent as text fallback via Baileys');

    return response;
  }, context);
}

/**
 * Sends interactive list message (fallback to text for Baileys)
 * Note: Baileys doesn't support interactive lists like Meta API
 */
export async function sendListMessage(
  to: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  waId?: string
): Promise<ServiceResponse<any>> {
  const context = { waId, operation: 'send_list_message', recipient: to };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    // Fallback: Convert list to numbered text options
    let fallbackText = `${bodyText}\n\n`;
    let optionNumber = 1;

    for (const section of sections) {
      fallbackText += `*${section.title}*\n`;
      for (const row of section.rows) {
        fallbackText += `${optionNumber}. ${row.title}`;
        if (row.description) {
          fallbackText += ` - ${row.description}`;
        }
        fallbackText += '\n';
        optionNumber++;
      }
      fallbackText += '\n';
    }

    fallbackText += `_Responda com o número da sua escolha_`;

    const jid = formatJid(to);
    const response = await sock.sendMessage(jid, { text: fallbackText });

    appLogger.info({
      messageId: response?.key?.id,
      to: jid,
      originalSections: sections,
      fallbackText
    }, 'List message sent as text fallback via Baileys');

    return response;
  }, context);
}

/**
 * Sends a reaction to a message via Baileys
 */
export async function sendReaction(to: string, messageId: string, emoji: string, waId?: string): Promise<ServiceResponse<any>> {
  const context = { waId, operation: 'send_reaction', recipient: to, messageId };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    const jid = formatJid(to);
    const response = await sock.sendMessage(jid, {
      react: {
        text: emoji,
        key: { id: messageId, remoteJid: jid }
      }
    });

    appLogger.info({
      messageId: response?.key?.id,
      to: jid,
      originalMessageId: messageId,
      emoji
    }, 'Reaction sent via Baileys');

    return response;
  }, context);
}

/**
 * Downloads media from WhatsApp via Baileys
 */
export async function downloadMedia(message: WAMessage, waId?: string): Promise<ServiceResponse<Buffer>> {
  const context = { waId, operation: 'download_media', messageId: message.key.id };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        reuploadRequest: sock.updateMediaMessage
      }
    );

    appLogger.info({
      messageId: message.key.id,
      from: message.key.remoteJid,
      mediaType: getContentType(message.message),
      bufferSize: buffer.length
    }, 'Media downloaded via Baileys');

    return buffer as Buffer;
  }, context);
}

/**
 * Convenience functions for sending reactions
 */
export async function sendQueuedReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<any>> {
  return sendReaction(to, messageId, "🔁", waId);
}

export async function sendWorkingReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<any>> {
  return sendReaction(to, messageId, "⚙️", waId);
}

export async function sendDoneReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<any>> {
  return sendReaction(to, messageId, "✅", waId);
}

export async function sendErrorReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<any>> {
  return sendReaction(to, messageId, "⚠️", waId);
}

/**
 * Utility function to format phone number as WhatsApp JID
 */
function formatJid(phoneNumber: string): string {
  // Remove any non-digit characters except +
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');

  // Remove + if present
  const number = cleaned.replace(/^\+/, '');

  // Add WhatsApp suffix if not present
  if (!number.includes('@')) {
    return `${number}@s.whatsapp.net`;
  }

  return number;
}

/**
 * Checks if a WhatsApp ID exists
 */
export async function checkWhatsAppId(phoneNumber: string, waId?: string): Promise<ServiceResponse<boolean>> {
  const context = { waId, operation: 'check_whatsapp_id', phoneNumber };

  return withServiceResponse(async () => {
    if (!sock) {
      throw new Error('WhatsApp socket not initialized');
    }

    const jid = formatJid(phoneNumber);
    const results = await sock.onWhatsApp(jid);
    const result = results?.[0];

    appLogger.info({
      phoneNumber,
      jid,
      exists: result?.exists || false
    }, 'WhatsApp ID existence checked');

    return result?.exists || false;
  }, context);
}