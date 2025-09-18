import { 
  WhatsAppOutgoingMessage, 
  WhatsAppApiResponse, 
  WhatsAppMediaDownloadResponse 
} from "../types/whatsapp.types";
import { ServiceResponse } from "../types/common.types";
import { whatsapp } from "../config/config";
import { appLogger } from "../utils/logger";
import { withServiceResponse, withRetry, sleep } from "../utils/retry";

/**
 * Sends a text message via WhatsApp API
 */
export async function sendTextMessage(to: string, text: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  const context = { waId, operation: 'send_text_message', recipient: to };

  return withServiceResponse(async () => {
    const payload: WhatsAppOutgoingMessage = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    };

    const response = await makeApiCall(payload);
    

    return response;
  }, context);
}

/**
 * Sends an image message via WhatsApp API
 */
export async function sendImageMessage(to: string, imageUrl: string, caption?: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  const context = { waId, operation: 'send_image_message', recipient: to };

  return withServiceResponse(async () => {
    const payload: WhatsAppOutgoingMessage = {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption }
    };

    const response = await makeApiCall(payload);
    

    return response;
  }, context);
}

/**
 * Sends a video message via WhatsApp API with delay
 */
export async function sendVideoMessage(to: string, videoUrl: string, caption?: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  const context = { waId, operation: 'send_video_message', recipient: to };

  return withServiceResponse(async () => {
    const payload: WhatsAppOutgoingMessage = {
      messaging_product: "whatsapp",
      to,
      type: "video",
      video: { link: videoUrl, caption }
    };

    const response = await makeApiCall(payload);
    
    // Add delay for video processing
    await sleep(10000);
    

    return response;
  }, context);
}

/**
 * Sends interactive button message via WhatsApp API
 */
export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  waId?: string
): Promise<ServiceResponse<WhatsAppApiResponse>> {
  const context = { waId, operation: 'send_button_message', recipient: to };

  return withServiceResponse(async () => {
    const payload: WhatsAppOutgoingMessage = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((btn) => ({
            type: "reply",
            reply: {
              id: btn.id,
              title: btn.title.substring(0, 20), // WhatsApp limit
            },
          })),
        },
      },
    };

    const response = await makeApiCall(payload);
    

    return response;
  }, context);
}

/**
 * Sends interactive list message via WhatsApp API
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
  const context = { waId, operation: 'send_list_message', recipient: to };

  return withServiceResponse(async () => {
    const payload: WhatsAppOutgoingMessage = {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections.map(section => ({
            title: section.title,
            rows: section.rows.map(row => ({
              id: row.id,
              title: row.title.substring(0, 24), // WhatsApp limit
              description: row.description?.substring(0, 72), // WhatsApp limit
            }))
          }))
        },
      },
    };

    const response = await makeApiCall(payload);
    

    return response;
  }, context);
}

/**
 * Sends a reaction to a message via WhatsApp API
 */
export async function sendReaction(to: string, messageId: string, emoji: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  const context = { waId, operation: 'send_reaction', recipient: to, messageId };

  return withServiceResponse(async () => {
    const payload: WhatsAppOutgoingMessage = {
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji }
    };

    const response = await makeApiCall(payload);
    

    return response;
  }, context);
}

/**
 * Downloads media from WhatsApp
 */
export async function downloadMedia(mediaId: string, waId?: string): Promise<ServiceResponse<Buffer>> {
  const context = { waId, operation: 'download_media', mediaId };

  return withServiceResponse(async () => {
    // First, get the media URL
    const mediaInfoResponse = await fetch(`${whatsapp.apiUrl}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${whatsapp.accessToken}`,
      },
    });

    if (!mediaInfoResponse.ok) {
      throw new Error(`Failed to get media info: ${mediaInfoResponse.status} ${mediaInfoResponse.statusText}`);
    }

    const mediaInfo = await mediaInfoResponse.json() as WhatsAppMediaDownloadResponse;

    // Download the actual media file
    const mediaResponse = await fetch(mediaInfo.url, {
      headers: {
        Authorization: `Bearer ${whatsapp.accessToken}`,
      },
    });

    if (!mediaResponse.ok) {
      throw new Error(`Failed to download media: ${mediaResponse.status} ${mediaResponse.statusText}`);
    }

    const buffer = Buffer.from(await mediaResponse.arrayBuffer());
    

    return buffer;
  }, context);
}

/**
 * Makes an API call to WhatsApp with retry logic
 */
async function makeApiCall(payload: WhatsAppOutgoingMessage): Promise<WhatsAppApiResponse> {
  return withRetry(async () => {
    const response = await fetch(`${whatsapp.apiUrl}/${whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsapp.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    // Log errors with full details for debugging
    if (!response.ok) {
      appLogger.error({ 
        payload,
        status: response.status, 
        statusText: response.statusText,
        response: responseData 
      }, `WhatsApp API error: ${response.status} ${response.statusText}`);
      
      const error = new Error(`WhatsApp API error: ${response.status} ${response.statusText} - ${responseText}`);
      (error as any).status = response.status;
      throw error;
    }

    // Log successful video messages with full response for debugging
    if (payload.type === 'video') {
      appLogger.info({ 
        videoUrl: payload.video?.link,
        response: responseData 
      }, "Video message sent - response details");
    }

    return responseData as WhatsAppApiResponse;
  }, { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 }, { operation: 'whatsapp_api_call' });
}

/**
 * Convenience functions for sending reactions
 */
export async function sendQueuedReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  return sendReaction(to, messageId, "🔁", waId);
}

export async function sendWorkingReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  return sendReaction(to, messageId, "⚙️", waId);
}

export async function sendDoneReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  return sendReaction(to, messageId, "✅", waId);
}

export async function sendErrorReaction(to: string, messageId: string, waId?: string): Promise<ServiceResponse<WhatsAppApiResponse>> {
  return sendReaction(to, messageId, "⚠️", waId);
}