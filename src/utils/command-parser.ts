/**
 * Command parser for WhatsApp bot commands
 */

export interface ParsedCommand {
  isCommand: boolean;
  command?: string;
  args?: string[];
}

/**
 * Parses a message to check if it's a command and extract command details
 */
export function parseCommand(message: string): ParsedCommand {
  const trimmed = message.trim();

  // Check if message starts with /
  if (!trimmed.startsWith('/')) {
    return { isCommand: false };
  }

  // Split by whitespace
  const parts = trimmed.split(/\s+/);
  const command = parts[0].substring(1).toLowerCase(); // Remove / and lowercase
  const args = parts.slice(1);

  return {
    isCommand: true,
    command,
    args
  };
}

/**
 * Validates a WhatsApp phone number format
 */
export function isValidWhatsAppNumber(number: string): boolean {
  // Remove any non-digit characters
  const cleaned = number.replace(/\D/g, '');

  // WhatsApp numbers are typically 10-15 digits
  // Should start with country code (e.g., 55 for Brazil)
  return cleaned.length >= 10 && cleaned.length <= 15;
}
