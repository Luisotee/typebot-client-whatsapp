/**
 * Validation utilities for input sanitization and verification
 */

/**
 * Validates WhatsApp ID format
 */
export function isValidWhatsAppId(waId: string): boolean {
  // WhatsApp IDs are typically phone numbers without '+' prefix
  const phoneRegex = /^\d{10,15}$/;
  return phoneRegex.test(waId);
}

/**
 * Sanitizes text input for WhatsApp messages
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove potentially harmful characters and limit length
  return text
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .trim()
    .substring(0, 4096); // WhatsApp message limit
}

/**
 * Validates URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?[\d\s-()]{10,20}$/;
  return phoneRegex.test(phone);
}

/**
 * Validates that a string is a valid UUID
 */
export function isValidUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validates mime type for supported media
 */
export function isValidMediaType(mimeType: string): boolean {
  const supportedTypes = [
    // Images
    'image/jpeg',
    'image/png',
    'image/webp',
    
    // Videos
    'video/mp4',
    'video/3gp',
    
    // Audio
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/amr',
    'audio/ogg',
    
    // Documents
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  
  return supportedTypes.includes(mimeType);
}

/**
 * Validates file size (in bytes)
 */
export function isValidFileSize(sizeBytes: number, type: 'image' | 'video' | 'audio' | 'document'): boolean {
  const limits = {
    image: 5 * 1024 * 1024,      // 5MB
    video: 16 * 1024 * 1024,     // 16MB
    audio: 16 * 1024 * 1024,     // 16MB
    document: 100 * 1024 * 1024, // 100MB
  };
  
  return sizeBytes <= limits[type];
}

/**
 * Validates WhatsApp button text (max 20 characters)
 */
export function isValidButtonText(text: string): boolean {
  return typeof text === 'string' && text.length > 0 && text.length <= 20;
}

/**
 * Validates WhatsApp list item title (max 24 characters)
 */
export function isValidListTitle(title: string): boolean {
  return typeof title === 'string' && title.length > 0 && title.length <= 24;
}

/**
 * Validates WhatsApp list item description (max 72 characters)
 */
export function isValidListDescription(description: string): boolean {
  return typeof description === 'string' && description.length <= 72;
}