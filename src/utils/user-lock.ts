/**
 * Per-user message processing lock
 *
 * Ensures that messages from the same user are processed sequentially
 * to prevent race conditions in session state updates.
 * Messages from different users still process in parallel.
 */

const userLocks = new Map<string, Promise<void>>();

/**
 * Executes an operation with a per-user lock.
 * If another operation is in progress for the same user, waits for it to complete first.
 *
 * @param waId - The WhatsApp ID of the user
 * @param operation - The async operation to execute
 * @returns The result of the operation
 */
export async function withUserLock<T>(
  waId: string,
  operation: () => Promise<T>
): Promise<T> {
  // Wait for any existing lock for this user
  const existingLock = userLocks.get(waId);
  if (existingLock) {
    await existingLock;
  }

  // Create a new lock for this operation
  let resolve: () => void;
  const lock = new Promise<void>(r => {
    resolve = r;
  });
  userLocks.set(waId, lock);

  try {
    return await operation();
  } finally {
    // Release the lock
    resolve!();
    // Only delete if this is still the current lock (prevents race with new locks)
    if (userLocks.get(waId) === lock) {
      userLocks.delete(waId);
    }
  }
}

/**
 * Gets the number of active locks (for monitoring)
 */
export function getActiveLockCount(): number {
  return userLocks.size;
}
