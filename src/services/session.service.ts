import { PrismaClient } from "@prisma/client";
import { ServiceResponse } from "../types/common.types";
import { appLogger } from "../utils/logger";
import { withServiceResponse } from "../utils/retry";
import { isValidWhatsAppId } from "../utils/validation";

// Prisma client reference for database operations
let prismaClient: PrismaClient | null = null;

// Active choice sessions stored in memory (cache backed by database)
const activeChoiceSessions = new Map<string, {
  sessionId: string;
  choices: Array<{ id: string; content: string }>;
  timestamp: Date;
  currentTypebotSlug?: string; // Track active typebot slug (for API calls)
}>();

// Expected input types stored in memory (cache backed by database)
const expectedInputTypes = new Map<string, {
  inputType: string;
  timestamp: Date;
}>();

// Session TTL in milliseconds (30 minutes)
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Load persisted session state from database on startup
 */
async function loadPersistedState(prisma: PrismaClient): Promise<void> {
  try {
    const now = new Date();

    // Load active choices that haven't expired
    const activeChoices = await prisma.activeChoice.findMany({
      where: { expiresAt: { gt: now } }
    });

    for (const choice of activeChoices) {
      activeChoiceSessions.set(choice.waId, {
        sessionId: choice.sessionId,
        choices: JSON.parse(choice.choices),
        timestamp: choice.createdAt,
        currentTypebotSlug: choice.typebotSlug || undefined
      });
    }

    // Load expected input types that haven't expired
    const inputTypes = await prisma.expectedInputType.findMany({
      where: { expiresAt: { gt: now } }
    });

    for (const input of inputTypes) {
      expectedInputTypes.set(input.waId, {
        inputType: input.inputType,
        timestamp: input.createdAt
      });
    }

    appLogger.info({
      activeChoices: activeChoices.length,
      inputTypes: inputTypes.length
    }, 'Loaded persisted session state from database');
  } catch (error) {
    appLogger.error({ error }, 'Failed to load persisted session state');
  }
}

/**
 * Clean up expired records from database
 */
async function cleanupExpiredDbRecords(prisma: PrismaClient): Promise<void> {
  try {
    const now = new Date();

    const deletedChoices = await prisma.activeChoice.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    const deletedInputTypes = await prisma.expectedInputType.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    if (deletedChoices.count > 0 || deletedInputTypes.count > 0) {
      appLogger.debug({
        deletedChoices: deletedChoices.count,
        deletedInputTypes: deletedInputTypes.count
      }, 'Cleaned up expired database records');
    }
  } catch (error) {
    appLogger.error({ error }, 'Failed to cleanup expired database records');
  }
}

/**
 * Initialize session management with automatic cleanup and database persistence
 */
export async function initializeSessionManagement(prisma: PrismaClient): Promise<void> {
  prismaClient = prisma;

  // Load persisted state from database
  await loadPersistedState(prisma);

  // Clean up old choice sessions every 5 minutes
  setInterval(async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    let cleanedChoices = 0;
    let cleanedInputTypes = 0;

    // Clean up expired choice sessions from memory
    for (const [waId, session] of activeChoiceSessions.entries()) {
      if (session.timestamp < fiveMinutesAgo) {
        activeChoiceSessions.delete(waId);
        cleanedChoices++;
      }
    }

    // Clean up expired expected input types from memory
    for (const [waId, inputType] of expectedInputTypes.entries()) {
      if (inputType.timestamp < fiveMinutesAgo) {
        expectedInputTypes.delete(waId);
        cleanedInputTypes++;
      }
    }

    // Also clean up expired records from database
    await cleanupExpiredDbRecords(prisma);

    if (cleanedChoices > 0 || cleanedInputTypes > 0) {
      appLogger.debug({ cleanedChoices, cleanedInputTypes }, 'Cleaned up expired sessions');
    }
  }, 5 * 60 * 1000);
}

/**
 * Gets or creates a user session
 */
export async function getOrCreateUser(prisma: PrismaClient, waId: string, name?: string): Promise<ServiceResponse<{ userId: number; isNew: boolean; user: any }>> {
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

    return { userId: user.id, isNew, user };
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
 * Sets active choices for audio matching (persisted to database)
 */
export async function setActiveChoices(
  waId: string,
  sessionId: string,
  choices: Array<{ id: string; content: string }>,
  typebotId?: string
): Promise<void> {
  const existing = activeChoiceSessions.get(waId);
  const now = new Date();
  const data = {
    sessionId,
    choices,
    timestamp: now,
    currentTypebotSlug: typebotId || existing?.currentTypebotSlug
  };

  // Update in-memory cache
  activeChoiceSessions.set(waId, data);

  // Persist to database
  if (prismaClient) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    try {
      await prismaClient.activeChoice.upsert({
        where: { waId },
        update: {
          sessionId,
          choices: JSON.stringify(choices),
          typebotSlug: data.currentTypebotSlug,
          expiresAt
        },
        create: {
          waId,
          sessionId,
          choices: JSON.stringify(choices),
          typebotSlug: data.currentTypebotSlug,
          expiresAt
        }
      });
    } catch (error) {
      appLogger.error({ waId, error }, 'Failed to persist active choices to database');
    }
  }

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
 * Clears active choices for a user (removes from database)
 */
export async function clearActiveChoices(waId: string): Promise<void> {
  const session = activeChoiceSessions.get(waId);

  // Clear from memory
  activeChoiceSessions.delete(waId);

  // Clear from database
  if (prismaClient) {
    try {
      await prismaClient.activeChoice.delete({
        where: { waId }
      }).catch(() => {
        // Ignore if not found
      });
    } catch (error) {
      // Ignore errors (record may not exist)
    }
  }

  if (session) {
    appLogger.debug({ waId, sessionId: session.sessionId },
      'Active choices cleared');
  }
}

/**
 * Sets expected input type for audio handling decision (persisted to database)
 */
export async function setExpectedInputType(waId: string, inputType: string): Promise<void> {
  const now = new Date();

  // Update in-memory cache
  expectedInputTypes.set(waId, {
    inputType,
    timestamp: now
  });

  // Persist to database
  if (prismaClient) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    try {
      await prismaClient.expectedInputType.upsert({
        where: { waId },
        update: {
          inputType,
          expiresAt
        },
        create: {
          waId,
          inputType,
          expiresAt
        }
      });
    } catch (error) {
      appLogger.error({ waId, error }, 'Failed to persist expected input type to database');
    }
  }

  appLogger.debug({ waId, inputType }, 'Expected input type set for user');
}

/**
 * Gets expected input type for audio handling decision
 */
export function getExpectedInputType(waId: string): string | null {
  const entry = expectedInputTypes.get(waId);

  if (!entry) {
    appLogger.debug({ waId }, 'No expected input type found for user');
    return null;
  }

  // Check if entry is too old (30 minutes)
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  if (entry.timestamp < thirtyMinutesAgo) {
    expectedInputTypes.delete(waId);
    appLogger.debug({ waId, inputType: entry.inputType },
      'Expected input type expired and removed');
    return null;
  }

  appLogger.debug({ waId, inputType: entry.inputType },
    'Retrieved expected input type for user');
  return entry.inputType;
}

/**
 * Clears expected input type for a user (removes from database)
 */
export async function clearExpectedInputType(waId: string): Promise<void> {
  const entry = expectedInputTypes.get(waId);

  // Clear from memory
  expectedInputTypes.delete(waId);

  // Clear from database
  if (prismaClient) {
    try {
      await prismaClient.expectedInputType.delete({
        where: { waId }
      }).catch(() => {
        // Ignore if not found
      });
    } catch (error) {
      // Ignore errors (record may not exist)
    }
  }

  if (entry) {
    appLogger.debug({ waId, inputType: entry.inputType },
      'Expected input type cleared');
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