import { ServiceResponse } from "../types/common.types";
import { WhatsAppApiResponse } from "../types/whatsapp.types";
import { config } from "../config/config";
import { appLogger } from "../utils/logger";

// Import both services
import * as MetaWhatsAppService from "./whatsapp.service";
import * as BaileysWhatsAppService from "./baileys-whatsapp.service";

/**
 * Unified WhatsApp service that delegates to either Meta API or Baileys
 * based on configuration
 */

/**
 * Initialize the WhatsApp service based on configuration
 */
export async function initializeWhatsAppService(): Promise<void> {
  if (config.whatsapp.mode === 'baileys') {
    appLogger.info({}, 'Initializing Baileys WhatsApp service');
    await BaileysWhatsAppService.initializeBaileySocket();
  } else {
    appLogger.info({}, 'Using Meta WhatsApp API service (no initialization required)');
  }
}

/**
 * Sends a text message via the configured WhatsApp service
 */
export async function sendTextMessage(to: string, text: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendTextMessage(to, text, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendTextMessage(to, text, waId);
  }
}

/**
 * Sends an image message via the configured WhatsApp service
 */
export async function sendImageMessage(to: string, imageUrl: string, caption?: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendImageMessage(to, imageUrl, caption, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendImageMessage(to, imageUrl, caption, waId);
  }
}

/**
 * Sends a video message via the configured WhatsApp service
 */
export async function sendVideoMessage(to: string, videoUrl: string, caption?: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendVideoMessage(to, videoUrl, caption, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendVideoMessage(to, videoUrl, caption, waId);
  }
}

/**
 * Sends interactive button message via the configured WhatsApp service
 * Note: For Baileys, this will fallback to text with numbered options
 */
export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  waId?: string
): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    appLogger.info({ to, buttonsCount: buttons.length }, 'Converting button message to text fallback for Baileys');
    const result = await BaileysWhatsAppService.sendButtonMessage(to, bodyText, buttons, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendButtonMessage(to, bodyText, buttons, waId);
  }
}

/**
 * Sends interactive list message via the configured WhatsApp service
 * Note: For Baileys, this will fallback to text with numbered options
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
): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    appLogger.info({ to, sectionsCount: sections.length }, 'Converting list message to text fallback for Baileys');
    const result = await BaileysWhatsAppService.sendListMessage(to, bodyText, buttonText, sections, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendListMessage(to, bodyText, buttonText, sections, waId);
  }
}

/**
 * Sends a reaction to a message via the configured WhatsApp service
 */
export async function sendReaction(to: string, messageId: string, emoji: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendReaction(to, messageId, emoji, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendReaction(to, messageId, emoji, waId);
  }
}

/**
 * Downloads media from WhatsApp via the configured service
 */
export async function downloadMedia(mediaIdOrMessage: string | any, waId?: string): Promise<ServiceResponse<Buffer>> {
  if (config.whatsapp.mode === 'baileys') {
    // For Baileys, mediaIdOrMessage should be a WAMessage object
    if (typeof mediaIdOrMessage === 'string') {
      return {
        success: false,
        error: 'Baileys requires WAMessage object for media download, not media ID'
      };
    }
    return BaileysWhatsAppService.downloadMedia(mediaIdOrMessage, waId);
  } else {
    // For Meta API, mediaIdOrMessage should be a media ID string
    if (typeof mediaIdOrMessage !== 'string') {
      return {
        success: false,
        error: 'Meta API requires media ID string for media download'
      };
    }
    return MetaWhatsAppService.downloadMedia(mediaIdOrMessage, waId);
  }
}

/**
 * Convenience functions for sending reactions
 */
export async function sendQueuedReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendQueuedReaction(to, messageId, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendQueuedReaction(to, messageId, waId);
  }
}

export async function sendWorkingReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendWorkingReaction(to, messageId, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendWorkingReaction(to, messageId, waId);
  }
}

export async function sendDoneReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendDoneReaction(to, messageId, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendDoneReaction(to, messageId, waId);
  }
}

export async function sendErrorReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  if (config.whatsapp.mode === 'baileys') {
    const result = await BaileysWhatsAppService.sendErrorReaction(to, messageId, waId);
    return {
      ...result,
      data: result.data ? { baileys: result.data } : undefined
    };
  } else {
    return MetaWhatsAppService.sendErrorReaction(to, messageId, waId);
  }
}

/**
 * Checks if a WhatsApp ID exists (Baileys only)
 */
export async function checkWhatsAppId(phoneNumber: string, waId?: string): Promise<ServiceResponse<boolean>> {
  if (config.whatsapp.mode === 'baileys') {
    return BaileysWhatsAppService.checkWhatsAppId(phoneNumber, waId);
  } else {
    // Meta API doesn't have direct ID checking capability
    return {
      success: false,
      error: 'WhatsApp ID checking is only available with Baileys mode'
    };
  }
}

/**
 * Gets current WhatsApp service mode
 */
export function getWhatsAppMode(): 'meta' | 'baileys' {
  return config.whatsapp.mode;
}

/**
 * Gets Baileys socket instance (only available in Baileys mode)
 */
export function getBaileysSocket() {
  if (config.whatsapp.mode === 'baileys') {
    return BaileysWhatsAppService.getSocket();
  }
  return null;
}