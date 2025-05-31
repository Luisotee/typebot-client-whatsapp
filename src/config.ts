import "dotenv/config";

export const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!;
export const ACCESS_TOKEN = process.env.WHATSAPP_TOKEN!;
export const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
export const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL!;
export const TYPEBOT_ID = process.env.TYPEBOT_ID!;
export const TYPEBOT_API_KEY = process.env.TYPEBOT_API_KEY!;
export const TYPEBOT_API_BASE =
  process.env.TYPEBOT_API_BASE || "https://bot.luisotee.com/api/v1";
export const TYPEBOT_API_URL = `${TYPEBOT_API_BASE}/typebots/${TYPEBOT_ID}/startChat`;
export const TYPEBOT_SESSION_URL = `${TYPEBOT_API_BASE}/sessions`;

export const QUEUED_REACTION = process.env.QUEUED_REACTION || "🔁";
export const WORKING_REACTION = process.env.WORKING_REACTION || "⚙️";
export const DONE_REACTION = process.env.DONE_REACTION || "✅";
export const ERROR_REACTION = process.env.ERROR_REACTION || "⚠️";

// Transcription settings
export const TRANSCRIPTION_ENABLED = process.env.TRANSCRIPTION_ENABLED === "true";
export const TRANSCRIPTION_TYPE = process.env.TRANSCRIPTION_TYPE || "groq";
export const TRANSCRIPTION_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || "pt";
export const GROQ_API_KEY = process.env.GROQ_API_KEY!;
export const GROQ_MODEL = process.env.GROQ_MODEL || "whisper-large-v3";
