import { JSDOM } from 'jsdom';
import type { ContentStrategy } from '../clean/mainContent.js';
import { htmlToMarkdown } from '../clean/toMarkdown.js';
import { productTemplate } from '../extract/templates/product.js';
import type { Template } from '../extract/template.js';
import type { Fetcher } from '../fetch/fetcher.js';
import { sizeMetrics, type SizeMetrics } from '../metrics/report.js';
import { detectBlocked, validate, type Status, type Validation } from '../validate/checks.js';

export const TEMPLATES: Record<string, Template<any>> = { product: productTemplate };

export interface ScrapeRequest {
  url: string;
  /** Run JavaScript in a real browser before reading the page. */
  render?: boolean;
  /** CSS selector to wait for when rendering. */
  waitFor?: string;
  /** Template name for structured output; omit for Markdown only. */
  template?: string;
}

export interface ScrapeResponse {
  url: string;
  status: Status;
  reasons: string[];
  data: unknown;
  markdown: string;
  contentStrategy: ContentStrategy;
  metrics: SizeMetrics & { fetchMs: number; processMs: number; attempts: number; httpStatus: number };
}

/** fetch → clean → extract → validate. One call, one self-describing result. */
export async function scrape(fetcher: Fetcher, req: ScrapeRequest): Promise<ScrapeResponse> {
  const page = await fetcher.fetch(req.url, {
    javaScript: req.render ?? true,
    waitFor: req.render === false ? undefined : req.waitFor,
    waitUntil: 'load',
  });

  const started = performance.now();
  const md = htmlToMarkdown(page.html, page.finalUrl);
  const doc = new JSDOM(page.html, { url: page.finalUrl }).window.document;

  const template = req.template ? TEMPLATES[req.template] : undefined;
  if (req.template && !template) throw new Error(`Unknown template "${req.template}"`);
  const verdict = template ? validate(doc, template) : blockCheckOnly(doc);

  return {
    url: page.finalUrl,
    status: verdict.status,
    reasons: verdict.reasons,
    data: verdict.data,
    markdown: md.markdown,
    contentStrategy: md.strategy,
    metrics: {
      ...sizeMetrics(page.html, md.markdown),
      fetchMs: page.durationMs,
      processMs: Math.round(performance.now() - started),
      attempts: page.attempts,
      httpStatus: page.status,
    },
  };
}

/** Markdown-only requests have no template, but a CAPTCHA page should still not come back "ok". */
function blockCheckOnly(doc: Document): Validation<unknown> {
  const blocked = detectBlocked(doc);
  return { status: blocked ? 'blocked' : 'ok', reasons: blocked ? [blocked] : [], data: null };
}
