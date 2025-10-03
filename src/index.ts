#!/usr/bin/env node

import { createApp } from './app';
import { appLogger } from './utils/logger';

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
  const gracefulShutdown = () => {
    appLogger.info({}, 'Received shutdown signal, closing server...');
    
    server.close((err) => {
      if (err) {
        appLogger.error({}, 'Error closing server', err);
        process.exit(1);
      }
      
      appLogger.info({}, 'Server closed successfully');
      
      // Close database connection
      const prisma = (app as any).prisma;
      if (prisma) {
        prisma.$disconnect()
          .then(() => {
            appLogger.info({}, 'Database connection closed');
            process.exit(0);
          })
          .catch((err: any) => {
            appLogger.error({}, 'Error closing database connection', err);
            process.exit(1);
          });
      } else {
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, _promise) => {
  appLogger.error(
    { operation: 'unhandled_rejection' },
    'Unhandled Promise Rejection',
    reason instanceof Error ? reason : new Error(String(reason))
  );
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