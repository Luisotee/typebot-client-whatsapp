import { PrismaClient } from "@prisma/client";
import { ServiceResponse } from "../types/common.types";
import { appLogger } from "../utils/logger";
import { withServiceResponse } from "../utils/retry";
import { isValidWhatsAppId } from "../utils/validation";

// Active choice sessions stored in memory
const activeChoiceSessions = new Map<string, {
  sessionId: string;
  choices: Array<{ id: string; content: string }>;
  timestamp: Date;
  currentTypebotSlug?: string; // Track active typebot slug (for API calls)
}>();

/**
 * Initialize session management with automatic cleanup
 */
export function initializeSessionManagement(): void {
  // Clean up old choice sessions every 5 minutes
  setInterval(() => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    let cleanedCount = 0;

    for (const [waId, session] of activeChoiceSessions.entries()) {
      if (session.timestamp < fiveMinutesAgo) {
        activeChoiceSessions.delete(waId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      appLogger.debug({ cleanedCount }, 'Cleaned up expired choice sessions');
    }
  }, 5 * 60 * 1000);
}

/**
 * Gets or creates a user session
 */
export async function getOrCreateUser(prisma: PrismaClient, waId: string, name?: string): Promise<ServiceResponse<{ userId: number; isNew: boolean }>> {
  const context = { waId, operation: 'get_or_create_user' };

  if (!isValidWhatsAppId(waId)) {
    return {
      success: false,
      error: 'Invalid WhatsApp ID format',
      code: 'INVALID_WA_ID'
    };
  }

  return withServiceResponse(async () => {
    // Try to find existing user
    let user = await prisma.user.findUnique({
      where: { waId }
    });

    let isNew = false;

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          waId,
          name: name || undefined,
        }
      });
      isNew = true;

      appLogger.sessionCreated({ ...context, userId: user.id });
    } else if (name && user.name !== name) {
      // Update user name if provided and different
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name }
      });
    }

    if (!isNew) {
      appLogger.sessionResumed({ ...context, lastActivity: user.updatedAt });
    }

    return { userId: user.id, isNew };
  }, context);
}

/**
 * Stores a message in the database
 */
export async function storeMessage(
  prisma: PrismaClient,
  userId: number,
  content: string,
  direction: 'in' | 'out',
  sessionId?: string,
  waId?: string
): Promise<ServiceResponse<{ messageId: number }>> {
  const context = { waId, sessionId, operation: 'store_message', direction };

  return withServiceResponse(async () => {
    const message = await prisma.message.create({
      data: {
        userId,
        content,
        direction,
        sessionId: sessionId || undefined,
      }
    });

    appLogger.debug({ ...context, messageId: String(message.id) }, 
      `Message stored: ${direction} - ${content.substring(0, 50)}...`);

    return { messageId: Number(message.id) };
  }, context);
}

/**
 * Gets user's recent messages
 */
export async function getUserMessages(
  prisma: PrismaClient,
  waId: string,
  limit: number = 10
): Promise<ServiceResponse<Array<{ content: string; direction: string; timestamp: Date }>>> {
  const context = { waId, operation: 'get_user_messages', limit };

  return withServiceResponse(async () => {
    const user = await prisma.user.findUnique({
      where: { waId },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: limit,
          select: {
            content: true,
            direction: true,
            timestamp: true,
          }
        }
      }
    });

    if (!user) {
      return [];
    }

    return user.messages.reverse(); // Return in chronological order
  }, context);
}

/**
 * Sets active choices for audio matching
 */
export function setActiveChoices(
  waId: string, 
  sessionId: string, 
  choices: Array<{ id: string; content: string }>,
  typebotId?: string
): void {
  const existing = activeChoiceSessions.get(waId);
  activeChoiceSessions.set(waId, {
    sessionId,
    choices,
    timestamp: new Date(),
    currentTypebotSlug: typebotId || existing?.currentTypebotSlug
  });

  appLogger.debug({ waId, sessionId, choicesCount: choices.length }, 
    'Active choices set for user');
}

/**
 * Gets active choices for audio matching
 */
export function getActiveChoices(waId: string): Array<{ id: string; content: string }> | null {
  const session = activeChoiceSessions.get(waId);
  
  if (!session) {
    return null;
  }

  // Check if session is too old (30 minutes)
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  if (session.timestamp < thirtyMinutesAgo) {
    activeChoiceSessions.delete(waId);
    appLogger.debug({ waId, sessionId: session.sessionId }, 
      'Active choices expired and removed');
    return null;
  }

  return session.choices;
}

/**
 * Gets active session ID for a user from database
 */
export async function getActiveSessionId(prisma: PrismaClient, waId: string): Promise<string | null> {
  const context = { waId, operation: 'get_active_session_id' };
  
  try {
    const user = await prisma.user.findUnique({
      where: { waId },
      select: { activeSessionId: true }
    });
    
    if (user?.activeSessionId) {
      appLogger.debug({ waId, sessionId: user.activeSessionId }, 
        'Found active session ID for user in database');
      return user.activeSessionId;
    }
    
    return null;
  } catch (error) {
    appLogger.error(context, 'Error getting active session ID from database', 
      error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Clears active choices for a user
 */
export function clearActiveChoices(waId: string): void {
  const session = activeChoiceSessions.get(waId);
  if (session) {
    activeChoiceSessions.delete(waId);
    appLogger.debug({ waId, sessionId: session.sessionId }, 
      'Active choices cleared');
  }
}

/**
 * Gets session statistics
 */
export async function getSessionStats(prisma: PrismaClient, waId: string): Promise<ServiceResponse<{
  messageCount: number;
  firstMessage: Date | null;
  lastMessage: Date | null;
  hasActiveChoices: boolean;
}>> {
  const context = { waId, operation: 'get_session_stats' };

  return withServiceResponse(async () => {
    const user = await prisma.user.findUnique({
      where: { waId },
      include: {
        messages: {
          select: {
            timestamp: true,
          },
          orderBy: {
            timestamp: 'asc'
          }
        }
      }
    });

    if (!user) {
      return {
        messageCount: 0,
        firstMessage: null,
        lastMessage: null,
        hasActiveChoices: false,
      };
    }

    return {
      messageCount: user.messages.length,
      firstMessage: user.messages[0]?.timestamp || null,
      lastMessage: user.messages[user.messages.length - 1]?.timestamp || null,
      hasActiveChoices: activeChoiceSessions.has(waId),
    };
  }, context);
}

/**
 * Cleans up old sessions and data
 */
export async function cleanupOldData(prisma: PrismaClient, olderThanDays: number = 30): Promise<ServiceResponse<{ deletedMessages: number }>> {
  const context = { operation: 'cleanup_old_data', olderThanDays };

  return withServiceResponse(async () => {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await prisma.message.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        }
      }
    });

    appLogger.info({ deletedCount: result.count, cutoffDate }, 
      'Old messages cleaned up');

    return { deletedMessages: result.count };
  }, context);
}

/**
 * Gets current active sessions count for monitoring
 */
export function getActiveSessionsCount(): number {
  return activeChoiceSessions.size;
}

/**
 * Gets the active typebot slug for a user from database
 */
export async function getActiveTypebotId(prisma: PrismaClient, waId: string): Promise<string | null> {
  const context = { waId, operation: 'get_active_typebot_id' };
  
  try {
    const user = await prisma.user.findUnique({
      where: { waId },
      select: { activeTypebotSlug: true }
    });
    
    if (user?.activeTypebotSlug) {
      appLogger.debug({ waId, typebotSlug: user.activeTypebotSlug }, 
        'Found active typebot slug for user in database');
      return user.activeTypebotSlug;
    }
    
    return null;
  } catch (error) {
    appLogger.error(context, 'Error getting active typebot ID from database', 
      error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Sets the active typebot slug for a user (when redirect happens)
 */
export async function setActiveTypebotId(
  prisma: PrismaClient, 
  waId: string, 
  typebotSlug: string,
  sessionId?: string | null
): Promise<ServiceResponse<void>> {
  const context = { waId, typebotSlug, sessionId, operation: 'set_active_typebot_id' };
  
  return withServiceResponse(async () => {
    await prisma.user.update({
      where: { waId },
      data: { 
        activeTypebotSlug: typebotSlug,
        activeSessionId: sessionId === null ? null : sessionId || undefined
      }
    });
    
    // Also update memory cache for choices if it exists
    const existing = activeChoiceSessions.get(waId);
    if (existing) {
      existing.currentTypebotSlug = typebotSlug;
      activeChoiceSessions.set(waId, existing);
    }
    
    appLogger.debug({ waId, typebotSlug, sessionId: sessionId === null ? 'cleared' : sessionId }, 
      'Updated active typebot slug in database');
  }, context);
}