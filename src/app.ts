import express from 'express';
import { PrismaClient } from '@prisma/client';
import { appLogger } from './utils/logger';
import { errorHandler, asyncHandler } from './middleware/error-handler';
import { skipLoggingFor } from './middleware/request-logger';
import { verifyWebhook, handleWebhook, healthCheck, handleBaileysMessage } from './controllers/webhook.controller';
import { initializeSessionManagement } from './services/session.service';
import { getTranscriptionInfo } from './services/transcription.service';
import { getActiveSessionsCountForProcessing } from './services/message-processing.service';
import { initializeWhatsAppService, getWhatsAppMode, getBaileysSocket } from './services/unified-whatsapp.service';
import { config } from './config/config';

/**
 * Creates and configures the Express application
 */
export function createApp(): express.Application {
  const app = express();
  
  // Initialize Prisma client
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ]
  });

  // Log Prisma events
  prisma.$on('error', (e) => {
    appLogger.error({ operation: 'prisma_error' }, 'Database error', new Error(e.message));
  });

  prisma.$on('warn', (e) => {
    appLogger.warn({ operation: 'prisma_warn' }, e.message);
  });

  if (process.env.LOG_LEVEL === 'debug') {
    prisma.$on('query', (e) => {
      appLogger.debug({
        operation: 'prisma_query',
        duration: e.duration,
        query: e.query.substring(0, 100)
      }, 'Database query executed');
    });
  }

  // Initialize services asynchronously
  const initializeServices = async () => {
    // Initialize session management with database persistence
    await initializeSessionManagement(prisma);

    // Initialize WhatsApp service (Baileys or Meta API)
    try {
      await initializeWhatsAppService();
      appLogger.info({ mode: getWhatsAppMode() }, 'WhatsApp service initialized successfully');

      // Set up Baileys event handlers if using Baileys
      if (config.whatsapp.mode === 'baileys') {
        setupBaileysEventHandlers(prisma);
      }
    } catch (error) {
      appLogger.error({ error }, 'Failed to initialize WhatsApp service');
      // Don't exit here, let the app start and maybe retry later
    }
  };

  // Initialize services asynchronously
  initializeServices();

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging (skip for health checks)
  app.use(skipLoggingFor(['/health', '/']));

  // Routes
  app.get('/', (req, res) => {
    res.json({
      service: 'WhatsApp-Typebot Integration',
      status: 'running',
      timestamp: new Date().toISOString(),
      version: '2.0.0'
    });
  });

  // Health check endpoint
  app.get('/health', asyncHandler(async (req, res) => {
    await healthCheck(req, res);
  }));

  // Webhook endpoints
  app.get('/webhook', asyncHandler(async (req, res) => {
    await verifyWebhook(req, res);
  }));

  app.post('/webhook', asyncHandler(async (req, res) => {
    await handleWebhook(prisma, req, res);
  }));

  // Service info endpoint
  app.get('/info', (req, res) => {
    res.json({
      services: {
        whatsapp: {
          mode: getWhatsAppMode(),
          connected: config.whatsapp.mode === 'baileys' ? !!getBaileysSocket() : 'unknown'
        },
        transcription: getTranscriptionInfo(),
        activeSessions: getActiveSessionsCountForProcessing(),
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler - catch all unmatched routes
  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: 'Endpoint not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString()
      }
    });
  });

  // Global error handler
  app.use(errorHandler);

  // Graceful shutdown handling
  const gracefulShutdown = async () => {
    appLogger.appShutdown();
    
    try {
      await prisma.$disconnect();
      appLogger.info({}, 'Database connection closed');
      process.exit(0);
    } catch (error) {
      appLogger.error({}, 'Error during graceful shutdown', 
        error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Store Prisma client reference for cleanup
  (app as any).prisma = prisma;

  return app;
}

/**
 * Sets up Baileys event handlers for message processing
 */
function setupBaileysEventHandlers(prisma: PrismaClient): void {
  const socket = getBaileysSocket();

  if (!socket) {
    appLogger.warn({}, 'Cannot setup Baileys event handlers - socket not available');
    return;
  }

  // Handle incoming messages
  socket.ev.on('messages.upsert', ({ messages }) => {
    for (const message of messages) {
      // Only process messages not sent by us
      if (!message.key.fromMe && message.message) {
        appLogger.debug({
          messageId: message.key.id || undefined,
          from: message.key.remoteJid || undefined,
          type: require('@whiskeysockets/baileys').getContentType(message.message)
        }, 'Processing incoming Baileys message');

        // Handle the message
        handleBaileysMessage(prisma, message).catch(error => {
          appLogger.error({
            messageId: message.key.id || undefined,
            from: message.key.remoteJid || undefined,
            error
          }, 'Error handling Baileys message');
        });
      }
    }
  });

  // Handle connection updates
  socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      appLogger.info({}, 'QR Code generated for WhatsApp connection');
    }

    if (connection) {
      appLogger.info({ connection }, `WhatsApp connection status: ${connection}`);
    }

    if (lastDisconnect) {
      appLogger.warn({
        error: lastDisconnect.error,
        statusCode: (lastDisconnect.error as any)?.output?.statusCode
      }, 'WhatsApp connection error');
    }
  });

  appLogger.info({}, 'Baileys event handlers set up successfully');
}