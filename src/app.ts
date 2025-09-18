import express from 'express';
import { PrismaClient } from '@prisma/client';
import { appLogger } from './utils/logger';
import { errorHandler, asyncHandler } from './middleware/error-handler';
import { skipLoggingFor } from './middleware/request-logger';
import { verifyWebhook, handleWebhook, healthCheck } from './controllers/webhook.controller';
import { initializeSessionManagement } from './services/session.service';
import { getTranscriptionInfo } from './services/transcription.service';
import { getActiveSessionsCountForProcessing } from './services/message-processing.service';

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

  // Initialize session management
  initializeSessionManagement();

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