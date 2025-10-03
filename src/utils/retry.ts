import { RetryOptions, ServiceResponse } from "../types/common.types";
import { appLogger } from "./logger";

/**
 * Default retry configuration
 */
export const defaultRetryOptions: RetryOptions = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Executes an operation with exponential backoff retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context: { waId?: string; operation: string } = { operation: 'unknown' }
): Promise<T> {
  const config = { ...defaultRetryOptions, ...options };
  let lastError: Error = new Error('Operation failed');
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 1) {
        appLogger.info(
          { waId: context.waId, operation: context.operation, attempt },
          `Operation succeeded on attempt ${attempt}`
        );
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === config.maxAttempts) {
        appLogger.error(
          { waId: context.waId, operation: context.operation, attempt, error: lastError },
          `Operation failed after ${config.maxAttempts} attempts`
        );
        break;
      }
      
      const delay = config.delayMs * Math.pow(config.backoffMultiplier, attempt - 1);
      
      appLogger.warn(
        { waId: context.waId, operation: context.operation, attempt, delay, error: lastError.message },
        `Operation failed, retrying in ${delay}ms`
      );
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Wraps a service method to return a standardized response with retry logic
 */
export async function withServiceResponse<T>(
  operation: () => Promise<T>,
  context: { waId?: string; operation: string },
  retryOptions?: Partial<RetryOptions>
): Promise<ServiceResponse<T>> {
  try {
    const data = await withRetry(operation, retryOptions, context);
    return { success: true, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { 
      success: false, 
      error: errorMessage,
      code: error instanceof Error && 'code' in error ? String(error.code) : undefined
    };
  }
}

/**
 * Sleep utility function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}