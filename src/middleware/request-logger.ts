import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../utils/logger';

/**
 * Request logging middleware
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);

  // Add request ID to response headers for tracing
  res.setHeader('X-Request-ID', requestId);

  // Log request start
  appLogger.debug({
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    operation: 'request_start'
  }, `${req.method} ${req.path} - Request started`);

  // Override res.json to log response
  const originalJson = res.json.bind(res);
  res.json = function(data: any) {
    const duration = Date.now() - startTime;
    
    appLogger.debug({
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      operation: 'request_complete'
    }, `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);

    return originalJson(data);
  };

  next();
}

/**
 * Skip logging for health checks and other specified paths
 */
export function skipLoggingFor(paths: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (paths.includes(req.path)) {
      return next();
    }
    return requestLogger(req, res, next);
  };
}