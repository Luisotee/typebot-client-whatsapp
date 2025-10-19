import { parseCommand, isValidWhatsAppNumber } from '../utils/command-parser';
import { addToWhitelist, removeFromWhitelist, listWhitelisted, isAdmin } from './whitelist.service';
import { appLogger } from '../utils/logger';

export interface CommandResult {
  handled: boolean;
  response?: string;
  shouldContinue: boolean; // Whether to continue normal message processing
}

/**
 * Handles admin commands for whitelist management
 */
export async function handleCommand(message: string, fromWaId: string): Promise<CommandResult> {
  const parsed = parseCommand(message);

  // If not a command, continue normal processing
  if (!parsed.isCommand) {
    return {
      handled: false,
      shouldContinue: true
    };
  }

  appLogger.info({ waId: fromWaId, command: parsed.command }, 'Processing command');

  // Only admins can execute commands
  if (!isAdmin(fromWaId)) {
    return {
      handled: true,
      response: '❌ Você não tem permissão para executar comandos administrativos.',
      shouldContinue: false
    };
  }

  switch (parsed.command) {
    case 'adicionar':
    case 'add':
      return await handleAddCommand(parsed.args || [], fromWaId);

    case 'remover':
    case 'remove':
    case 'rm':
      return await handleRemoveCommand(parsed.args || [], fromWaId);

    case 'listar':
    case 'list':
    case 'ls':
      return await handleListCommand(fromWaId);

    case 'ajuda':
    case 'help':
      return handleHelpCommand();

    default:
      return {
        handled: true,
        response: `❌ Comando desconhecido: /${parsed.command}\n\nUse /ajuda para ver os comandos disponíveis.`,
        shouldContinue: false
      };
  }
}

/**
 * Handles /adicionar command
 */
async function handleAddCommand(args: string[], fromWaId: string): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: '❌ Uso: /adicionar <número>\n\nExemplo: /adicionar 5511999999999',
      shouldContinue: false
    };
  }

  const phoneNumber = args[0].replace(/\D/g, ''); // Remove non-digits

  if (!isValidWhatsAppNumber(phoneNumber)) {
    return {
      handled: true,
      response: '❌ Número inválido. Use o formato: 5511999999999 (com DDI e DDD)',
      shouldContinue: false
    };
  }

  const result = await addToWhitelist(phoneNumber, fromWaId);

  return {
    handled: true,
    response: result.message,
    shouldContinue: false
  };
}

/**
 * Handles /remover command
 */
async function handleRemoveCommand(args: string[], fromWaId: string): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: '❌ Uso: /remover <número>\n\nExemplo: /remover 5511999999999',
      shouldContinue: false
    };
  }

  const phoneNumber = args[0].replace(/\D/g, ''); // Remove non-digits

  if (!isValidWhatsAppNumber(phoneNumber)) {
    return {
      handled: true,
      response: '❌ Número inválido. Use o formato: 5511999999999 (com DDI e DDD)',
      shouldContinue: false
    };
  }

  const result = await removeFromWhitelist(phoneNumber, fromWaId);

  return {
    handled: true,
    response: result.message,
    shouldContinue: false
  };
}

/**
 * Handles /listar command
 */
async function handleListCommand(fromWaId: string): Promise<CommandResult> {
  const result = await listWhitelisted(fromWaId);

  return {
    handled: true,
    response: result.message,
    shouldContinue: false
  };
}

/**
 * Handles /ajuda command
 */
function handleHelpCommand(): CommandResult {
  const helpText = `📚 *Comandos Disponíveis (Admin)*

*Gerenciamento de Whitelist:*
• /adicionar <número> - Adiciona um usuário à whitelist
• /remover <número> - Remove um usuário da whitelist
• /listar - Lista todos os usuários permitidos

*Outros:*
• /ajuda - Mostra esta mensagem

*Exemplos:*
/adicionar 5511999999999
/remover 5511999999999
/listar`;

  return {
    handled: true,
    response: helpText,
    shouldContinue: false
  };
}
