import { ACCESS_TOKEN, WHATSAPP_API_URL } from "./config";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export interface MediaDownloadResult {
  buffer: Buffer;
  mimeType: string;
  success: boolean;
  error?: string;
}

export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<MediaDownloadResult> {
  try {
    // First, get media URL
    const mediaInfoResponse = await fetch(`${WHATSAPP_API_URL}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    if (!mediaInfoResponse.ok) {
      throw new Error(`Failed to get media info: ${mediaInfoResponse.status}`);
    }

    const mediaInfo = await mediaInfoResponse.json();
    const mediaUrl = mediaInfo.url;
    const mimeType = mediaInfo.mime_type;

    logger.info({ mediaId, mediaUrl, mimeType }, "Downloading WhatsApp media");

    // Download the actual media file
    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    if (!mediaResponse.ok) {
      throw new Error(`Failed to download media: ${mediaResponse.status}`);
    }

    const buffer = Buffer.from(await mediaResponse.arrayBuffer());

    logger.info({ mediaId, size: buffer.length }, "Media downloaded successfully");

    return {
      buffer,
      mimeType,
      success: true,
    };
  } catch (error) {
    logger.error({ error, mediaId }, "Error downloading WhatsApp media");
    return {
      buffer: Buffer.alloc(0),
      mimeType: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
