import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { CleanError } from '../errors.js';
import { absolutizeLinks, normalizeTables, removeNoise } from './preclean.js';
import { extractMainContent, type ContentStrategy, type MainContentOptions } from './mainContent.js';

export interface ToMarkdownOptions extends MainContentOptions {
  /** Keep ![alt](src) image references. Off by default: they cost tokens and agents rarely need them. */
  keepImages?: boolean;
}

export interface MarkdownResult {
  markdown: string;
  title: string;
  strategy: ContentStrategy;
  coverage: number;
  removedNodes: number;
  tablesNormalized: number;
}

export function htmlToMarkdown(html: string, url: string, opts: ToMarkdownOptions = {}): MarkdownResult {
  const doc = parseHtml(html, url);
  const removedNodes = removeNoise(doc);
  absolutizeLinks(doc);
  const tablesNormalized = normalizeTables(doc);

  const main = extractMainContent(doc, opts);
  const body = main.html.trim() ? turndown(opts).turndown(main.html) : '';
  const markdown = postProcess(withTitle(main.title, body));

  return { markdown, title: main.title, strategy: main.strategy, coverage: main.coverage, removedNodes, tablesNormalized };
}

function parseHtml(html: string, url: string): Document {
  try {
    return new JSDOM(html, { url }).window.document;
  } catch (err) {
    throw new CleanError(`Could not parse HTML for ${url}`, { cause: err });
  }
}

function turndown(opts: ToMarkdownOptions): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });
  service.use(gfm);
  if (!opts.keepImages) {
    service.addRule('drop-images', { filter: 'img', replacement: () => '' });
  }
  // Links with no visible text are pure noise for an agent.
  service.addRule('drop-empty-links', {
    filter: (node) => node.nodeName === 'A' && !(node.textContent ?? '').trim(),
    replacement: () => '',
  });
  return service;
}

/** Prepend the page title as an H1 unless the content already starts with it. */
function withTitle(title: string, body: string): string {
  if (!title) return body;
  const firstLine = body.trimStart().split('\n', 1)[0] ?? '';
  const alreadyThere = firstLine.replace(/^#+\s*/, '').trim() === title;
  return alreadyThere ? body : `# ${title}\n\n${body}`;
}

export function postProcess(md: string): string {
  return md
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\s*-\s*$/gm, '') // bullets emptied by dropped images/links
    .replace(/^(\s*)([-*]|\d+\.) {2,}/gm, '$1$2 ') // turndown pads list markers; spaces cost tokens
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}
