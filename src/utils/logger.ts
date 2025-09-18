import pino from "pino";
import { LogContext } from "../types/common.types";

/**
 * Creates a structured logger with human-readable formatting
 */
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
    log: (object) => {
      // Extract common fields for better formatting
      const { waId, messageId, sessionId, operation, duration, ...rest } = object as any;
      
      return {
        ...rest,
        ...(waId && { user: waId }),
        ...(messageId && { message: messageId }),
        ...(sessionId && { session: sessionId }),
        ...(operation && { op: operation }),
        ...(duration && { timing: `${duration}ms` }),
      };
    }
  },
  serializers: {
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  }
});

/**
 * Enhanced logger with semantic methods for different operations
 */
class AppLogger {
  private baseLogger = logger;

  /**
   * Log incoming WhatsApp webhook events
   */
  webhookReceived(context: LogContext & { messageType?: string; contactName?: string }) {
    this.baseLogger.info(context, `📨 WhatsApp message received from ${context.contactName || context.waId} (${context.messageType || 'unknown'})`);
  }

  /**
   * Log message processing start
   */
  messageProcessingStart(context: LogContext) {
    this.baseLogger.info(context, `⚡ Processing message from user ${context.waId}`);
  }

  /**
   * Log message processing completion
   */
  messageProcessingComplete(context: LogContext & { success: boolean; responseType?: string }) {
    const emoji = context.success ? '✅' : '❌';
    const status = context.success ? 'completed' : 'failed';
    const message = `${emoji} Message processing ${status}`;
    
    if (context.success) {
      this.baseLogger.info(context, `${message} - Sent ${context.responseType || 'response'} to ${context.waId}`);
    } else {
      this.baseLogger.error(context, message);
    }
  }

  /**
   * Log Typebot API interactions
   */
  typebotApiCall(context: LogContext & { endpoint: string; method: string }) {
    this.baseLogger.info(context, `🤖 Calling Typebot API: ${context.method} ${context.endpoint}`);
  }

  typebotApiSuccess(context: LogContext & { endpoint: string; messagesCount: number }) {
    this.baseLogger.info(context, `🎯 Typebot API success: Received ${context.messagesCount} messages from ${context.endpoint}`);
  }

  typebotApiError(context: LogContext & { endpoint: string; statusCode?: number; error: string }) {
    this.baseLogger.error(context, `💥 Typebot API error: ${context.statusCode || 'Unknown'} - ${context.error}`);
  }

  /**
   * Log WhatsApp API interactions
   */
  whatsappApiCall(context: LogContext & { messageType: string; recipient: string }) {
    this.baseLogger.info(context, `📤 Sending ${context.messageType} message to ${context.recipient}`);
  }

  whatsappApiSuccess(context: LogContext & { messageType: string; messageId: string }) {
    this.baseLogger.info(context, `📬 WhatsApp message sent successfully: ${context.messageType} (ID: ${context.messageId})`);
  }

  whatsappApiError(context: LogContext & { messageType: string; error: string }) {
    this.baseLogger.error(context, `📵 WhatsApp API error sending ${context.messageType}: ${context.error}`);
  }

  /**
   * Log transcription operations
   */
  transcriptionStart(context: LogContext & { audioSize: number; mimeType: string }) {
    this.baseLogger.info(context, `🎤 Starting audio transcription: ${context.audioSize} bytes (${context.mimeType})`);
  }

  transcriptionComplete(context: LogContext & { success: boolean; transcriptionText?: string; error?: string }) {
    if (context.success) {
      this.baseLogger.info(context, `🔊 Transcription completed: "${context.transcriptionText}"`);
    } else {
      this.baseLogger.error(context, `🔇 Transcription failed: ${context.error}`);
    }
  }

  /**
   * Log choice matching operations
   */
  choiceMatching(context: LogContext & { transcription: string; choicesCount: number; bestMatch?: string; score?: number }) {
    if (context.bestMatch) {
      this.baseLogger.info(context, `🎯 Choice matched: "${context.transcription}" → "${context.bestMatch}" (score: ${context.score?.toFixed(2)})`);
    } else {
      this.baseLogger.info(context, `🔍 No choice match found for: "${context.transcription}" (${context.choicesCount} options)`);
    }
  }

  /**
   * Log session management
   */
  sessionCreated(context: LogContext & { userId: number }) {
    this.baseLogger.info(context, `🆕 New session created for user ${context.waId} (DB ID: ${context.userId})`);
  }

  sessionResumed(context: LogContext & { lastActivity: Date }) {
    this.baseLogger.info(context, `🔄 Session resumed for user ${context.waId} (last active: ${context.lastActivity.toLocaleString()})`);
  }

  sessionExpired(context: LogContext) {
    this.baseLogger.info(context, `⏰ Session expired for user ${context.waId}`);
  }

  /**
   * Log errors with context
   */
  error(context: LogContext, message: string, error?: Error) {
    this.baseLogger.error({ ...context, error }, `❌ ${message}`);
  }

  /**
   * Log warnings
   */
  warn(context: LogContext, message: string) {
    this.baseLogger.warn(context, `⚠️  ${message}`);
  }

  /**
   * Log general info
   */
  info(context: LogContext, message: string) {
    this.baseLogger.info(context, message);
  }

  /**
   * Log debug information
   */
  debug(context: LogContext, message: string) {
    this.baseLogger.debug(context, message);
  }

  /**
   * Log application startup
   */
  appStarted(port: number) {
    this.baseLogger.info({}, `🚀 WhatsApp-Typebot Integration Server started on port ${port}`);
  }

  /**
   * Log application shutdown
   */
  appShutdown() {
    this.baseLogger.info({}, `🛑 WhatsApp-Typebot Integration Server shutting down`);
  }

  /**
   * Log performance metrics
   */
  performance(context: LogContext & { operation: string; duration: number }) {
    const emoji = context.duration > 5000 ? '🐌' : context.duration > 1000 ? '⏱️' : '⚡';
    this.baseLogger.info(context, `${emoji} ${context.operation} completed in ${context.duration}ms`);
  }
}

export const appLogger = new AppLogger();
export { logger };