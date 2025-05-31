import {
  GROQ_API_KEY,
  GROQ_MODEL,
  TRANSCRIPTION_LANGUAGE,
  TRANSCRIPTION_TYPE,
} from "./config";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export interface TranscriptionResult {
  text: string;
  success: boolean;
  error?: string;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string
): Promise<TranscriptionResult> {
  try {
    if (TRANSCRIPTION_TYPE === "groq") {
      return await transcribeWithGroq(audioBuffer, mimeType);
    } else if (TRANSCRIPTION_TYPE === "local") {
      // Future implementation for local transcription
      throw new Error("Local transcription not implemented yet");
    } else {
      throw new Error(`Unknown transcription type: ${TRANSCRIPTION_TYPE}`);
    }
  } catch (error) {
    logger.error({ error }, "Error during audio transcription");
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function transcribeWithGroq(
  audioBuffer: Buffer,
  mimeType: string
): Promise<TranscriptionResult> {
  try {
    logger.info({ mimeType, size: audioBuffer.length }, "Starting Groq transcription");

    // Convert audio buffer to supported format if needed
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: mimeType });

    // Determine file extension based on mime type
    let filename = "audio.ogg"; // Default for WhatsApp audio
    if (mimeType.includes("mp3")) filename = "audio.mp3";
    else if (mimeType.includes("wav")) filename = "audio.wav";
    else if (mimeType.includes("m4a")) filename = "audio.m4a";

    formData.append("file", audioBlob, filename);
    formData.append("model", GROQ_MODEL);
    formData.append("language", TRANSCRIPTION_LANGUAGE);
    formData.append("response_format", "json");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, "Groq API error");
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    logger.info({ transcription: result.text }, "Groq transcription completed");

    return {
      text: result.text,
      success: true,
    };
  } catch (error) {
    logger.error({ error }, "Error in Groq transcription");
    return {
      text: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
