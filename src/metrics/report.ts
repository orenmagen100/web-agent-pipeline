import { byteLength, countTokens } from './tokens.js';

export interface SizeMetrics {
  htmlBytes: number;
  markdownBytes: number;
  htmlTokens: number;
  markdownTokens: number;
  /** 0..100, share of tokens removed by cleaning. */
  tokenReductionPct: number;
}

export function sizeMetrics(html: string, markdown: string): SizeMetrics {
  const htmlTokens = countTokens(html);
  const markdownTokens = countTokens(markdown);
  return {
    htmlBytes: byteLength(html),
    markdownBytes: byteLength(markdown),
    htmlTokens,
    markdownTokens,
    tokenReductionPct: htmlTokens === 0 ? 0 : round1(100 * (1 - markdownTokens / htmlTokens)),
  };
}

export function formatSizeLine(label: string, m: SizeMetrics): string {
  return (
    `${label}: html ${kb(m.htmlBytes)} / ${m.htmlTokens} tok -> ` +
    `md ${kb(m.markdownBytes)} / ${m.markdownTokens} tok (-${m.tokenReductionPct}% tokens)`
  );
}

/** Render rows as a GitHub Markdown table (used for the README results table). */
export function markdownTable(headers: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
