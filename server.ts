#!/usr/bin/env node
/**
 * Demo server:
 *   /            the playground UI
 *   /shop/...    a tiny fictional shop to scrape (books.toscrape-style markup)
 *   /api/scrape  the "web API": URL in -> Markdown + structured JSON + validation status out
 */
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { FetchError } from './src/errors.js';
import { Fetcher } from './src/fetch/fetcher.js';
import { scrape, TEMPLATES } from './src/pipeline/scrape.js';

const PORT = Number(process.env.PORT ?? 3000);
const DEMO_DIR = join(import.meta.dirname, '..', 'demo');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

const fetcher = new Fetcher();

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/scrape') return handleScrape(url, res);
  if (url.pathname === '/api/templates') return json(res, 200, Object.keys(TEMPLATES));
  if (url.pathname === '/') return serveFile(res, join(DEMO_DIR, 'ui', 'index.html'));
  if (url.pathname.startsWith('/shop/')) {
    const rel = url.pathname === '/shop/' ? 'index.html' : url.pathname.slice('/shop/'.length);
    return serveFile(res, join(DEMO_DIR, 'shop', normalize(rel).replace(/^(\.\.[/\\])+/, '')));
  }
  json(res, 404, { error: 'not found' });
}

async function handleScrape(url: URL, res: ServerResponse): Promise<void> {
  const target = url.searchParams.get('url');
  if (!target) return json(res, 400, { error: 'missing ?url=' });
  try {
    const result = await scrape(fetcher, {
      url: target,
      render: url.searchParams.get('render') !== 'false',
      waitFor: url.searchParams.get('waitFor') || undefined,
      template: url.searchParams.get('template') || undefined,
    });
    json(res, 200, result);
  } catch (err) {
    // A failed fetch is still a well-formed answer: status "failed" plus the reason.
    const reason = err instanceof FetchError ? `${err.kind}: ${err.message}` : (err as Error).message;
    json(res, 200, { url: target, status: 'failed', reasons: [reason], data: null, markdown: '', metrics: null });
  }
}

async function serveFile(res: ServerResponse, path: string): Promise<void> {
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>');
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body, null, 2));
}

await fetcher.start();
createServer((req, res) => void handle(req, res)).listen(PORT, () => {
  console.log(`Playground:  http://localhost:${PORT}/`);
  console.log(`Demo shop:   http://localhost:${PORT}/shop/`);
  console.log(`API example: http://localhost:${PORT}/api/scrape?url=http://localhost:${PORT}/shop/static-product.html&template=product`);
});
process.on('SIGINT', () => void fetcher.close().then(() => process.exit(0)));
