/**
 * @file async.ts
 * @description Asynchronous execution utilities and promise timeouts.
 */

/**
 * Executes a Promise with a specified timeout limit (default 10,000ms).
 * Rejects with a timeout Error if execution exceeds the limit.
 *
 * @param promise - Promise to execute.
 * @param timeoutMs - Timeout threshold in milliseconds.
 * @returns Resolves with the original promise result.
 */
export async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 10000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Request timed out. Please try again."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
