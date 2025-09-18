export interface AppConfig {
  // WhatsApp Configuration
  whatsapp: {
    verifyToken: string;
    accessToken: string;
    phoneNumberId: string;
    apiUrl: string;
  };
  
  // Typebot Configuration
  typebot: {
    id: string;
    apiKey: string;
    apiBase: string;
    apiUrl: string;
    sessionUrl: string;
  };
  
  // Transcription Configuration
  transcription: {
    enabled: boolean;
    type: 'groq' | 'local';
    language: string;
    groq: {
      apiKey: string;
      model: string;
    };
  };
  
  // Reaction Configuration
  reactions: {
    queued: string;
    working: string;
    done: string;
    error: string;
  };
  
  // Bot Configuration
  bot: {
    language: string;
  };
  
  // Database Configuration
  database: {
    url: string;
  };
}

export interface ProcessedMessage {
  id: string;
  waId: string;
  content: string;
  type: MessageContentType;
  timestamp: Date;
  sessionId?: string;
  mediaUrl?: string;
  transcription?: TranscriptionResult;
}

export type MessageContentType = 
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'interactive'
  | 'button'
  | 'document';

export interface TranscriptionResult {
  text: string;
  success: boolean;
  error?: string;
  matchedChoice?: {
    id: string;
    content: string;
    score: number;
  };
}

export interface UserSession {
  waId: string;
  sessionId?: string;
  name?: string;
  lastActivity: Date;
  activeChoices?: Array<{
    id: string;
    content: string;
  }>;
}

export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface LogContext {
  waId?: string;
  messageId?: string;
  sessionId?: string;
  operation?: string;
  duration?: number;
  [key: string]: any;
}

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
}

export interface QueuedMessage {
  id: string;
  waId: string;
  content: string;
  type: string;
  attempts: number;
  createdAt: Date;
  scheduledAt: Date;
}