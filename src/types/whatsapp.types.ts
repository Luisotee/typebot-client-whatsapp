export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppMessageStatus[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string; // Phone number (extracted from LID if necessary)
  timestamp: string;
  type: WhatsAppMessageType;
  text?: WhatsAppTextMessage;
  image?: WhatsAppMediaMessage;
  video?: WhatsAppMediaMessage;
  audio?: WhatsAppMediaMessage;
  document?: WhatsAppMediaMessage;
  interactive?: WhatsAppInteractiveMessage;
  button?: WhatsAppButtonMessage;
  context?: WhatsAppMessageContext;
  // Baileys compatibility fields
  baileys?: {
    rawMessage?: any;
    messageTimestamp?: number;
    remoteJid?: string; // Original JID for sending replies (may be @lid format)
  };
}

export type WhatsAppMessageType = 
  | 'text' 
  | 'image' 
  | 'video' 
  | 'audio' 
  | 'document' 
  | 'interactive' 
  | 'button'
  | 'reaction';

export interface WhatsAppTextMessage {
  body: string;
}

export interface WhatsAppMediaMessage {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}

export interface WhatsAppInteractiveMessage {
  type: 'button_reply' | 'list_reply' | 'text_reply'; // Added text_reply for Baileys fallbacks
  button_reply?: {
    id: string;
    title: string;
  };
  list_reply?: {
    id: string;
    title: string;
    description?: string;
  };
  // Baileys fallback for interactive messages
  text_reply?: {
    text: string;
    originalNumber?: number; // For numbered responses
  };
}

export interface WhatsAppButtonMessage {
  text: string;
  payload: string;
}

export interface WhatsAppMessageContext {
  from: string;
  id: string;
}

export interface WhatsAppMessageStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

// Outgoing message types
export interface WhatsAppOutgoingMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: WhatsAppMessageType;
  text?: { body: string };
  image?: { link: string; caption?: string };
  video?: { link: string; caption?: string };
  interactive?: WhatsAppInteractive;
  reaction?: { message_id: string; emoji: string };
}

export interface WhatsAppInteractive {
  type: 'button' | 'list';
  body: { text: string };
  action: WhatsAppAction;
}

export interface WhatsAppAction {
  button?: string;
  buttons?: WhatsAppButton[];
  sections?: WhatsAppSection[];
}

export interface WhatsAppButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface WhatsAppSection {
  title: string;
  rows: WhatsAppRow[];
}

export interface WhatsAppRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppApiResponse {
  messaging_product?: string; // Optional for Baileys compatibility
  contacts?: Array<{
    input: string;
    wa_id: string;
  }>;
  messages?: Array<{
    id: string;
  }>;
  // Baileys response format
  baileys?: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    messageTimestamp: number;
  };
}

export interface WhatsAppMediaDownloadResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}