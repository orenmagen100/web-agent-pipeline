import { chromium, errors as pwErrors, type Browser, type BrowserContext } from 'playwright';
import { FetchError } from '../errors.js';
import { withRetry } from './backoff.js';

export interface FetchOptions {
  /** CSS selector that must appear before we snapshot the DOM (for JS-rendered pages). */
  waitFor?: string;
  /** Page lifecycle event to wait for when no selector is given. */
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';
  /** false = snapshot the server HTML only, as a plain HTTP client would see it. */
  javaScript?: boolean;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  attempts: number;
  durationMs: number;
}

const DEFAULTS = {
  waitUntil: 'networkidle',
  javaScript: true,
  timeoutMs: 20_000,
  retries: 2,
  backoffMs: 500,
} as const;

const USER_AGENT = 'web-agent-pipeline/0.1 (portfolio prototype; polite crawler)';

/**
 * One browser, many pages. Contexts are cheap and isolated, so each fetch gets its own
 * (no shared cookies/cache between fetches, which keeps results reproducible).
 */
export class Fetcher {
  private browser: Browser | undefined;

  async start(): Promise<void> {
    this.browser ??= await chromium.launch({ headless: true });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const opts = { ...DEFAULTS, ...options };
    await this.start();
    const started = performance.now();

    const { value, attempts } = await withRetry((_attempt) => this.fetchOnce(url, opts), {
      retries: opts.retries,
      baseMs: opts.backoffMs,
      isRetryable: (err) => err instanceof FetchError && err.retryable,
    });

    return { ...value, attempts, durationMs: Math.round(performance.now() - started) };
  }

  private async fetchOnce(
    url: string,
    opts: Required<Omit<FetchOptions, 'waitFor'>> & Pick<FetchOptions, 'waitFor'>,
  ): Promise<Omit<FetchResult, 'attempts' | 'durationMs'>> {
    const context = await this.newContext(opts.javaScript);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(opts.timeoutMs);

      // With a selector we only need the DOM; the selector wait is the real readiness signal.
      const waitUntil = opts.waitFor ? 'domcontentloaded' : opts.waitUntil;
      const response = await page.goto(url, { waitUntil }).catch((err) => {
        throw toFetchError(err, url);
      });
      if (!response) throw new FetchError('network', url, 'No response received');

      const status = response.status();
      if (status >= 400) throw new FetchError('http', url, `HTTP ${status}`, status);

      if (opts.waitFor) {
        await page.waitForSelector(opts.waitFor, { state: 'attached' }).catch((err) => {
          if (err instanceof pwErrors.TimeoutError) {
            throw new FetchError('selector', url, `Selector "${opts.waitFor}" never appeared`, status, {
              cause: err,
            });
          }
          throw toFetchError(err, url);
        });
      }

      return { url, finalUrl: page.url(), status, html: await page.content() };
    } finally {
      await context.close();
    }
  }

  private async newContext(javaScriptEnabled: boolean): Promise<BrowserContext> {
    if (!this.browser) throw new Error('Fetcher not started');
    return this.browser.newContext({ javaScriptEnabled, userAgent: USER_AGENT });
  }
}

function toFetchError(err: unknown, url: string): FetchError {
  if (err instanceof FetchError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const kind = err instanceof pwErrors.TimeoutError ? 'timeout' : 'network';
  return new FetchError(kind, url, message.split('\n')[0] ?? message, undefined, { cause: err });
}
