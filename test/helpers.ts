import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const fixture = (relPath: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', relPath), 'utf8');

export type Route = (hit: number) => { status: number; body: string };

/** Tiny local HTTP server so fetcher tests run offline. `hit` counts requests per path. */
export async function startServer(routes: Record<string, Route>): Promise<{ base: string; server: Server }> {
  const hits = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    const route = routes[path];
    const { status, body } = route ? route(hit) : { status: 404, body: 'not found' };
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}
