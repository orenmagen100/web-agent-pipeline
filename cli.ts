#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FetchError } from './src/errors.js';
import { Fetcher } from './src/fetch/fetcher.js';
import { formatSizeLine } from './src/metrics/report.js';
import { cleanPage, compareJsRendering, fetchAndClean, writeCleanedPage } from './src/pipeline/run.js';

const USAGE = `Usage:
  cli fetch    --url <url> [--wait-for <selector>] [--no-js] [--out out/] [--save-fixture <path>]
  cli convert  --html <file> --url <original url> [--out out/]     (offline, from a fixture)
  cli js-compare --url <url> --wait-for <selector> [--out out/]`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    html: { type: 'string' },
    'wait-for': { type: 'string' },
    'no-js': { type: 'boolean', default: false },
    out: { type: 'string', default: 'out' },
    'save-fixture': { type: 'string' },
    timeout: { type: 'string', default: '20000' },
  },
});

async function main(): Promise<void> {
  const [command] = positionals;
  switch (command) {
    case 'fetch':
      return withFetcher(cmdFetch);
    case 'convert':
      return cmdConvert();
    case 'js-compare':
      return withFetcher(cmdJsCompare);
    default:
      console.error(USAGE);
      process.exitCode = 2;
  }
}

async function cmdFetch(fetcher: Fetcher): Promise<void> {
  const url = required('url');
  const page = await fetchAndClean(fetcher, url, {
    waitFor: values['wait-for'],
    javaScript: !values['no-js'],
    timeoutMs: Number(values.timeout),
  });
  await writeCleanedPage(page, values.out!);
  if (values['save-fixture']) {
    await writeFile(values['save-fixture'], page.html);
  }
  console.log(formatSizeLine(url, page.metrics));
  console.log(`  strategy=${page.markdown.strategy} fetch=${page.metrics.fetchMs}ms clean=${page.metrics.cleanMs}ms -> ${values.out}/`);
}

async function cmdConvert(): Promise<void> {
  const url = required('url');
  const html = await readFile(required('html'), 'utf8');
  const page = cleanPage(url, html);
  await writeCleanedPage(page, values.out!);
  console.log(formatSizeLine(url, page.metrics));
  console.log(`  strategy=${page.markdown.strategy} clean=${page.metrics.cleanMs}ms -> ${values.out}/`);
}

async function cmdJsCompare(fetcher: Fetcher): Promise<void> {
  const url = required('url');
  const selector = required('wait-for');
  const cmp = await compareJsRendering(fetcher, url, selector);
  await writeCleanedPage(cmp.withoutJs, join(values.out!, 'no-js'));
  await writeCleanedPage(cmp.withJs, join(values.out!, 'rendered'));
  console.log(formatSizeLine('no-js   ', cmp.withoutJs.metrics), `| "${selector}" present: ${cmp.selectorPresent.withoutJs}`);
  console.log(formatSizeLine('rendered', cmp.withJs.metrics), `| "${selector}" present: ${cmp.selectorPresent.withJs}`);
}

async function withFetcher(fn: (f: Fetcher) => Promise<void>): Promise<void> {
  const fetcher = new Fetcher();
  try {
    await fn(fetcher);
  } finally {
    await fetcher.close();
  }
}

function required(name: 'url' | 'html' | 'wait-for'): string {
  const value = values[name];
  if (!value) {
    console.error(`Missing --${name}\n\n${USAGE}`);
    process.exit(2);
  }
  return value;
}

main().catch((err: unknown) => {
  if (err instanceof FetchError) {
    console.error(`FetchError[${err.kind}${err.status ? ` ${err.status}` : ''}] ${err.url}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
