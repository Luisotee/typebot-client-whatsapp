import { TranscriptionResult, ServiceResponse } from "../types/common.types";
import { transcription } from "../config/config";
import { appLogger } from "../utils/logger";
import { withServiceResponse, withRetry } from "../utils/retry";
import { isValidMediaType } from "../utils/validation";

/**
 * Transcribes audio buffer to text
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  waId?: string
): Promise<ServiceResponse<TranscriptionResult>> {
  const context = { waId, operation: 'transcribe_audio', audioSize: audioBuffer.length, mimeType };

  if (!transcription.enabled) {
    return {
      success: false,
      error: 'Transcription is disabled',
      code: 'TRANSCRIPTION_DISABLED'
    };
  }

  if (!isValidMediaType(mimeType) || !mimeType.startsWith('audio/')) {
    return {
      success: false,
      error: `Unsupported audio format: ${mimeType}`,
      code: 'INVALID_MEDIA_TYPE'
    };
  }

  appLogger.transcriptionStart(context);

  return withServiceResponse(async () => {
    let result: TranscriptionResult;

    if (transcription.type === 'groq') {
      result = await transcribeWithGroq(audioBuffer, mimeType, context);
    } else if (transcription.type === 'local') {
      throw new Error('Local transcription not implemented yet');
    } else {
      throw new Error(`Unknown transcription type: ${transcription.type}`);
    }

    appLogger.transcriptionComplete({
      ...context,
      success: result.success,
      transcriptionText: result.text,
      error: result.error
    });

    return result;
  }, context);
}

/**
 * Transcribes audio using Groq API
 */
async function transcribeWithGroq(
  audioBuffer: Buffer,
  mimeType: string,
  context: any
): Promise<TranscriptionResult> {
  return withRetry(async () => {
    // Convert audio buffer to supported format
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: mimeType });

    // Determine file extension based on mime type
    const filename = getFilenameFromMimeType(mimeType);

    formData.append("file", audioBlob, filename);
    formData.append("model", transcription.groq.model);
    formData.append("language", transcription.language);
    formData.append("response_format", "json");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${transcription.groq.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as any;

    return {
      text: result.text || '',
      success: true,
    };
  }, 
  { maxAttempts: 3, delayMs: 2000, backoffMultiplier: 1.5 },
  { ...context, operation: 'groq_transcription' }
  );
}

/**
 * Gets appropriate filename based on mime type
 */
function getFilenameFromMimeType(mimeType: string): string {
  const extensionMap: Record<string, string> = {
    'audio/mpeg': 'audio.mp3',
    'audio/mp4': 'audio.m4a',
    'audio/wav': 'audio.wav',
    'audio/aac': 'audio.aac',
    'audio/amr': 'audio.amr',
    'audio/ogg': 'audio.ogg',
  };

  return extensionMap[mimeType] || 'audio.ogg';
}

/**
 * Checks if transcription is enabled and properly configured
 */
export function isTranscriptionAvailable(): boolean {
  if (!transcription.enabled) {
    return false;
  }

  if (transcription.type === 'groq') {
    return !!transcription.groq.apiKey;
  }

  return false;
}

/**
 * Gets transcription configuration info
 */
export function getTranscriptionInfo(): { enabled: boolean; type: string; language: string; model?: string } {
  return {
    enabled: transcription.enabled,
    type: transcription.type,
    language: transcription.language,
    ...(transcription.type === 'groq' && { model: transcription.groq.model })
  };
}