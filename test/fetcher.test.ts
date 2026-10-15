import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError } from '../src/errors.js';
import { Fetcher } from '../src/fetch/fetcher.js';
import { compareJsRendering } from '../src/pipeline/run.js';
import { fixture, startServer } from './helpers.js';

describe('Fetcher (local server)', () => {
  const fetcher = new Fetcher();
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await startServer({
      '/js': () => ({ status: 200, body: fixture('synthetic/js-rendered.html') }),
      '/flaky': (hit) => (hit < 3 ? { status: 503, body: 'busy' } : { status: 200, body: '<title>ok</title><p>ok</p>' }),
      '/gone': () => ({ status: 404, body: 'gone' }),
    }));
    await fetcher.start();
  });

  afterAll(async () => {
    await fetcher.close();
    server.close();
  });

  it('shows the JS-rendering gap: content is missing without JS and present after waiting', async () => {
    const cmp = await compareJsRendering(fetcher, `${base}/js`, '.quote');
    expect(cmp.selectorPresent).toEqual({ withoutJs: false, withJs: true });
    expect(cmp.withoutJs.markdown.markdown).not.toContain('Dijkstra');
    expect(cmp.withJs.markdown.markdown).toContain('Dijkstra');
  });

  it('retries 5xx responses with backoff and reports attempts', async () => {
    const result = await fetcher.fetch(`${base}/flaky`, { retries: 3, backoffMs: 10 });
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(3);
  });

  it('does not retry a 404 and throws a typed http error', async () => {
    const err = await fetcher.fetch(`${base}/gone`, { retries: 3, backoffMs: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err).toMatchObject({ kind: 'http', status: 404, retryable: false });
  });

  it('throws a typed selector error when waitFor never matches', async () => {
    const err = await fetcher
      .fetch(`${base}/js`, { waitFor: '.never', timeoutMs: 1_000, retries: 0 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'selector' });
  });
});
