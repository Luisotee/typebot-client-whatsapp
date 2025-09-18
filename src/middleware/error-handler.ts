import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../utils/logger';

export interface AppError extends Error {
  status?: number;
  code?: string;
}

/**
 * Global error handling middleware
 */
export function errorHandler(
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const context = {
    operation: 'error_handler',
    method: req.method,
    path: req.path,
    status: error.status || 500,
    error: error.message
  };

  appLogger.error(context, 'Unhandled error in request', error);

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : error.message;

  res.status(error.status || 500).json({
    error: {
      message,
      code: error.code || 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}