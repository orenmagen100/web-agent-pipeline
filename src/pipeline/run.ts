import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { htmlToMarkdown, type MarkdownResult } from '../clean/toMarkdown.js';
import type { FetchOptions, FetchResult, Fetcher } from '../fetch/fetcher.js';
import { sizeMetrics, type SizeMetrics } from '../metrics/report.js';

export interface CleanedPage {
  url: string;
  html: string;
  markdown: MarkdownResult;
  metrics: SizeMetrics & { fetchMs?: number; cleanMs: number; attempts?: number };
}

/** Clean HTML we already have (from a fixture or a fetch). Pure apart from timing. */
export function cleanPage(url: string, html: string, fetch?: Pick<FetchResult, 'durationMs' | 'attempts'>): CleanedPage {
  const started = performance.now();
  const markdown = htmlToMarkdown(html, url);
  const cleanMs = Math.round(performance.now() - started);
  return {
    url,
    html,
    markdown,
    metrics: { ...sizeMetrics(html, markdown.markdown), cleanMs, fetchMs: fetch?.durationMs, attempts: fetch?.attempts },
  };
}

export async function fetchAndClean(fetcher: Fetcher, url: string, opts: FetchOptions = {}): Promise<CleanedPage> {
  const result = await fetcher.fetch(url, opts);
  return cleanPage(result.finalUrl, result.html, result);
}

export async function writeCleanedPage(page: CleanedPage, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const { markdown, metrics } = page;
  await Promise.all([
    writeFile(join(outDir, 'page.html'), page.html),
    writeFile(join(outDir, 'page.md'), markdown.markdown),
    writeFile(
      join(outDir, 'metrics.json'),
      JSON.stringify(
        { url: page.url, strategy: markdown.strategy, coverage: round2(markdown.coverage), ...metrics },
        null,
        2,
      ),
    ),
  ]);
}

export interface JsComparison {
  url: string;
  withoutJs: CleanedPage;
  withJs: CleanedPage;
  /** Does the selector we wait for exist in each snapshot? */
  selectorPresent: { withoutJs: boolean; withJs: boolean };
}

/**
 * The JS-rendering problem in one measurement: snapshot the page as a plain HTTP client
 * would (JavaScript off) and after rendering (JavaScript on + wait for `selector`).
 */
export async function compareJsRendering(fetcher: Fetcher, url: string, selector: string): Promise<JsComparison> {
  const withoutJs = await fetchAndClean(fetcher, url, { javaScript: false, waitUntil: 'load' });
  const withJs = await fetchAndClean(fetcher, url, { javaScript: true, waitFor: selector });
  return {
    url,
    withoutJs,
    withJs,
    selectorPresent: {
      withoutJs: hasSelector(withoutJs.html, selector),
      withJs: hasSelector(withJs.html, selector),
    },
  };
}

function hasSelector(html: string, selector: string): boolean {
  return new JSDOM(html).window.document.querySelector(selector) !== null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
