/** Typed errors so callers can branch on `kind` instead of parsing messages. */

export type FetchErrorKind = 'timeout' | 'network' | 'http' | 'selector';

export class FetchError extends Error {
  override readonly name = 'FetchError';

  constructor(
    readonly kind: FetchErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  /** Transient failures are worth retrying; a 404 or a missing selector usually is not. */
  get retryable(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network') return true;
    if (this.kind === 'http') return this.status === 429 || (this.status ?? 0) >= 500;
    return false;
  }
}

export class CleanError extends Error {
  override readonly name = 'CleanError';
}
