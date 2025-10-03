import { WAMessage, proto } from '@whiskeysockets/baileys';

// Baileys-specific message types
export interface BaileysWebhookPayload {
  messages: WAMessage[];
  type: 'messages.upsert';
}

export interface BaileysIncomingMessage {
  id: string;
  from: string;
  timestamp: number;
  type: BaileysMessageType;
  text?: string;
  caption?: string;
  mediaId?: string;
  mimeType?: string;
  interactive?: BaileysInteractiveResponse;
  context?: BaileysMessageContext;
  rawMessage: WAMessage;
}

export type BaileysMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction';

export interface BaileysInteractiveResponse {
  type: 'text_reply'; // Baileys doesn't have button_reply/list_reply, using text_reply for numbered responses
  text: string;
  originalNumber?: number; // For fallback button/list responses
}

export interface BaileysMessageContext {
  from: string;
  id: string;
  quoted?: boolean;
}

// Baileys API response (simpler than Meta API)
export interface BaileysApiResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  messageTimestamp: number;
  status?: proto.WebMessageInfo.Status;
}

// Configuration updates for Baileys
export interface BaileysConfig {
  sessionDir: string;
  browser: string;
  printQRInTerminal: boolean;
  markOnlineOnConnect: boolean;
  syncFullHistory: boolean;
}

// Utility types for migration
export interface MessageMigrationResult {
  success: boolean;
  baileyMessage?: BaileysIncomingMessage;
  error?: string;
  originalMessage: any; // Meta API message
}

export interface MediaMigrationResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  error?: string;
}