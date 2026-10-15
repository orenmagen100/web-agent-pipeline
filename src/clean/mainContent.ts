import { Readability } from '@mozilla/readability';

export type ContentStrategy = 'readability' | 'main-element' | 'body';

export interface MainContent {
  html: string;
  title: string;
  strategy: ContentStrategy;
  /** Text length of the chosen content vs the whole cleaned body (0..1). */
  coverage: number;
}

export interface MainContentOptions {
  /** Below this share of the body's text, Readability is assumed to have picked a fragment. */
  minCoverage?: number;
  minChars?: number;
}

const textLength = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim().length;

/**
 * Picks the main content of an already-precleaned document.
 *
 * Readability is tuned for articles. On listing pages (product grids, quote lists) it
 * often keeps a single item, so we guard it with a coverage check and fall back to
 * <main>/[role=main] or the cleaned <body>. The chosen strategy is reported so the
 * decision is visible in metrics rather than silent.
 */
export function extractMainContent(doc: Document, opts: MainContentOptions = {}): MainContent {
  const { minCoverage = 0.4, minChars = 200 } = opts;
  const bodyChars = Math.max(1, textLength(doc.body));
  const title = doc.title.trim();

  // Readability mutates its input, so hand it a clone.
  const article = new Readability(doc.cloneNode(true) as Document, { keepClasses: false }).parse();
  if (article?.content && article.textContent) {
    const chars = article.textContent.replace(/\s+/g, ' ').trim().length;
    const coverage = chars / bodyChars;
    if (chars >= minChars && coverage >= minCoverage) {
      return { html: article.content, title: article.title || title, strategy: 'readability', coverage };
    }
  }

  const main = doc.querySelector('main, [role="main"], article');
  if (main && textLength(main) >= minChars) {
    return { html: main.innerHTML, title, strategy: 'main-element', coverage: textLength(main) / bodyChars };
  }

  return { html: doc.body?.innerHTML ?? '', title, strategy: 'body', coverage: 1 };
}
