import { PrismaClient } from '@prisma/client';
import { whitelist } from '../config/config';
import { appLogger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Checks if a user is an admin (from environment variable)
 */
export function isAdmin(waId: string): boolean {
  return whitelist.admins.includes(waId);
}

/**
 * Checks if a user is whitelisted (either admin or in database)
 */
export async function isWhitelisted(waId: string): Promise<boolean> {
  // If whitelist is disabled, everyone is allowed
  if (!whitelist.enabled) {
    return true;
  }

  // Admins are always whitelisted
  if (isAdmin(waId)) {
    return true;
  }

  // Check database
  try {
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { waId }
    });
    return whitelistedUser !== null;
  } catch (error) {
    appLogger.error({ waId }, 'Error checking whitelist status', error as Error);
    return false;
  }
}

/**
 * Adds a user to the whitelist
 */
export async function addToWhitelist(waId: string, addedBy: string): Promise<{ success: boolean; message: string }> {
  try {
    // Check if already whitelisted
    const existing = await prisma.whitelistedUser.findUnique({
      where: { waId }
    });

    if (existing) {
      return {
        success: false,
        message: `Usuário ${waId} já está na whitelist.`
      };
    }

    // Add to whitelist
    await prisma.whitelistedUser.create({
      data: {
        waId,
        addedBy
      }
    });

    appLogger.info({ waId, addedBy }, `User added to whitelist`);

    return {
      success: true,
      message: `✅ Usuário ${waId} adicionado à whitelist com sucesso!`
    };
  } catch (error) {
    appLogger.error({ waId, addedBy }, 'Error adding user to whitelist', error as Error);
    return {
      success: false,
      message: `❌ Erro ao adicionar usuário: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
    };
  }
}

/**
 * Removes a user from the whitelist
 */
export async function removeFromWhitelist(waId: string, removedBy: string): Promise<{ success: boolean; message: string }> {
  try {
    // Check if user exists in whitelist
    const existing = await prisma.whitelistedUser.findUnique({
      where: { waId }
    });

    if (!existing) {
      return {
        success: false,
        message: `Usuário ${waId} não está na whitelist.`
      };
    }

    // Remove from whitelist
    await prisma.whitelistedUser.delete({
      where: { waId }
    });

    appLogger.info({ waId, removedBy }, `User removed from whitelist`);

    return {
      success: true,
      message: `✅ Usuário ${waId} removido da whitelist com sucesso!`
    };
  } catch (error) {
    appLogger.error({ waId, removedBy }, 'Error removing user from whitelist', error as Error);
    return {
      success: false,
      message: `❌ Erro ao remover usuário: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
    };
  }
}

/**
 * Lists all whitelisted users
 */
export async function listWhitelisted(requestedBy: string): Promise<{ success: boolean; message: string; users?: string[] }> {
  try {
    if (!isAdmin(requestedBy)) {
      return {
        success: false,
        message: '❌ Apenas administradores podem listar usuários na whitelist.'
      };
    }

    const users = await prisma.whitelistedUser.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const adminList = whitelist.admins.map(admin => `${admin} (Admin)`);
    const userList = users.map(u => u.waId);
    const allUsers = [...adminList, ...userList];

    const message = allUsers.length > 0
      ? `📋 *Usuários na Whitelist:*\n\n${allUsers.join('\n')}\n\n_Total: ${allUsers.length} usuários_`
      : '📋 Nenhum usuário na whitelist.';

    return {
      success: true,
      message,
      users: allUsers
    };
  } catch (error) {
    appLogger.error({ requestedBy }, 'Error listing whitelisted users', error as Error);
    return {
      success: false,
      message: '❌ Erro ao listar usuários na whitelist.'
    };
  }
}
