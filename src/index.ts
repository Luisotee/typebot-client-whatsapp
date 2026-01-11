#!/usr/bin/env node

import { createApp } from './app';
import { appLogger } from './utils/logger';
import { closeSocket } from './services/baileys-whatsapp.service';
import { config } from './config/config';

// Track shutdown state to prevent multiple shutdown attempts
let isShuttingDown = false;

/**
 * Start the server
 */
function startServer(): void {
  const app = createApp();
  const port = process.env.PORT || 3000;

  const server = app.listen(port, () => {
    appLogger.appStarted(Number(port));
    
    // Log service information
    appLogger.info({}, `
🤖 WhatsApp-Typebot Integration Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Listening on port: ${port}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
📊 Log level: ${process.env.LOG_LEVEL || 'info'}
🔗 Webhook URL: /webhook
💡 Health check: /health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });

  // Handle server errors
  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      appLogger.error({}, `Port ${port} is already in use`, error);
      process.exit(1);
    } else {
      appLogger.error({}, 'Server error', error);
    }
  });

  // Graceful shutdown
  const gracefulShutdown = async () => {
    if (isShuttingDown) {
      appLogger.info({}, 'Shutdown already in progress...');
      return;
    }
    isShuttingDown = true;

    appLogger.info({}, 'Received shutdown signal, initiating graceful shutdown...');

    // Set a hard timeout to force exit if shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      appLogger.error({}, 'Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 30000); // 30 second timeout

    try {
      // 1. Stop accepting new connections
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            appLogger.error({}, 'Error closing HTTP server', err);
            reject(err);
          } else {
            appLogger.info({}, 'HTTP server closed');
            resolve();
          }
        });
      });

      // 2. Wait briefly for in-flight requests to complete
      appLogger.info({}, 'Waiting for in-flight requests to complete...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 3. Close Baileys socket if using Baileys mode
      if (config.whatsapp.mode === 'baileys') {
        try {
          closeSocket();
        } catch (err) {
          appLogger.error({}, 'Error closing Baileys socket', err as Error);
        }
      }

      // 4. Close database connection
      const prisma = (app as any).prisma;
      if (prisma) {
        await prisma.$disconnect();
        appLogger.info({}, 'Database connection closed');
      }

      clearTimeout(forceExitTimeout);
      appLogger.info({}, 'Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimeout);
      appLogger.error({}, 'Error during graceful shutdown', error as Error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

// Handle unhandled promise rejections - exit to prevent corrupted state
process.on('unhandledRejection', (reason, _promise) => {
  appLogger.error(
    { operation: 'unhandled_rejection' },
    'Unhandled Promise Rejection - shutting down',
    reason instanceof Error ? reason : new Error(String(reason))
  );
  // Give time for logs to flush, then exit
  setTimeout(() => process.exit(1), 1000);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  appLogger.error(
    { operation: 'uncaught_exception' },
    'Uncaught Exception',
    error
  );
  process.exit(1);
});

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}