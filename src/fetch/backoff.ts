export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter: random in [0, base * 2^attempt], capped. */
export function backoffDelay(attempt: number, baseMs: number, capMs = 10_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(Math.random() * ceiling);
}

export interface RetryOptions {
  retries: number;
  baseMs: number;
  isRetryable: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/** Runs `fn`, retrying retryable errors. Returns the value plus how many attempts it took. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<{ value: T; attempts: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt + 1 };
    } catch (err) {
      if (attempt >= opts.retries || !opts.isRetryable(err)) throw err;
      const delay = backoffDelay(attempt, opts.baseMs);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
