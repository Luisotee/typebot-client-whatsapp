import "dotenv/config";
import { AppConfig } from "../types/common.types";

/**
 * Validates that all required environment variables are present
 */
function validateRequiredEnvVars(): void {
  // Check if using Baileys or Meta API
  const useBaileys = process.env.WHATSAPP_MODE === 'baileys';

  const baseRequired = [
    'TYPEBOT_ID',
    'TYPEBOT_API_KEY',
    'DATABASE_URL'
  ];

  const metaApiRequired = [
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_API_URL'
  ];

  const required = useBaileys ? baseRequired : [...baseRequired, ...metaApiRequired];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate transcription requirements if enabled
  if (process.env.TRANSCRIPTION_ENABLED === 'true') {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is required when TRANSCRIPTION_ENABLED is true');
    }
  }
}

/**
 * Validates URLs format
 */
function validateUrl(url: string, name: string): void {
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL format for ${name}: ${url}`);
  }
}

/**
 * Loads and validates the application configuration
 */
export function loadConfig(): AppConfig {
  validateRequiredEnvVars();
  
  const whatsappApiUrl = process.env.WHATSAPP_API_URL!;
  const typebotApiBase = process.env.TYPEBOT_API_BASE || "https://bot.luisotee.com/api/v1";
  const typebotId = process.env.TYPEBOT_ID!;
  
  // Validate URLs
  validateUrl(whatsappApiUrl, 'WHATSAPP_API_URL');
  validateUrl(typebotApiBase, 'TYPEBOT_API_BASE');
  
  const useBaileys = process.env.WHATSAPP_MODE === 'baileys';

  const config: AppConfig = {
    whatsapp: {
      mode: useBaileys ? 'baileys' : 'meta',
      // Meta API fields (optional when using Baileys)
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
      accessToken: process.env.WHATSAPP_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      apiUrl: process.env.WHATSAPP_API_URL || '',
      // Baileys specific configuration
      baileys: {
        sessionDir: process.env.BAILEYS_SESSION_DIR || 'auth_info_baileys',
        browser: process.env.BAILEYS_BROWSER || 'TypeBot WhatsApp Client',
        printQRInTerminal: process.env.BAILEYS_PRINT_QR !== 'false',
        markOnlineOnConnect: process.env.BAILEYS_MARK_ONLINE === 'true',
        syncFullHistory: process.env.BAILEYS_SYNC_HISTORY === 'true'
      }
    },
    
    typebot: {
      id: typebotId,
      apiKey: process.env.TYPEBOT_API_KEY!,
      apiBase: typebotApiBase,
      apiUrl: `${typebotApiBase}/typebots/${typebotId}/startChat`,
      sessionUrl: `${typebotApiBase}/sessions`,
    },
    
    transcription: {
      enabled: process.env.TRANSCRIPTION_ENABLED === 'true',
      type: (process.env.TRANSCRIPTION_TYPE as 'groq' | 'local') || 'groq',
      language: process.env.TRANSCRIPTION_LANGUAGE || 'pt',
      groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || 'whisper-large-v3',
      },
    },
    
    reactions: {
      queued: process.env.QUEUED_REACTION || '🔁',
      working: process.env.WORKING_REACTION || '⚙️',
      done: process.env.DONE_REACTION || '✅',
      error: process.env.ERROR_REACTION || '⚠️',
    },
    
    bot: {
      language: process.env.BOT_LANGUAGE || 'en',
    },
    
    database: {
      url: process.env.DATABASE_URL!,
    },
  };
  
  return config;
}

/**
 * Global configuration instance
 */
export const config = loadConfig();

/**
 * Export individual config sections for convenience
 */
export const { 
  whatsapp, 
  typebot, 
  transcription, 
  reactions, 
  bot, 
  database 
} = config;

/**
 * Configuration validation on module load
 */
try {
  config; // Trigger validation
  console.log('✅ Configuration loaded and validated successfully');
} catch (error) {
  console.error('❌ Configuration validation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}