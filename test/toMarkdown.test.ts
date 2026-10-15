import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/clean/toMarkdown.js';
import { fixture } from './helpers.js';

describe('htmlToMarkdown (synthetic noisy product page)', () => {
  const { markdown, strategy } = htmlToMarkdown(fixture('synthetic/noisy-product.html'), 'https://shop.example/p/widget');

  it('keeps headings and lists', () => {
    expect(markdown).toMatch(/^# Widget Pro 3000$/m);
    expect(markdown).toMatch(/^## Highlights$/m);
    expect(markdown).toMatch(/^- Aluminium body$/m);
  });

  it('removes nav, footer, aside, scripts, styles and the cookie banner', () => {
    for (const noise of ['Category A', '© 2026', 'Customers also bought', 'analytics', 'color:red', 'cookies']) {
      expect(markdown).not.toContain(noise);
    }
  });

  it('converts a header-less key/value table into a GFM table', () => {
    expect(markdown).toContain('| Field | Value |');
    expect(markdown).toContain('| Price | £49.99 |');
    expect(markdown).not.toContain('<table');
  });

  it('keeps a regular table with its header row', () => {
    expect(markdown).toContain('| Region | Days | Cost |\n| --- | --- | --- |');
  });

  it('makes links absolute', () => {
    expect(markdown).toContain('[standard accessories](https://shop.example/accessories)');
    expect(markdown).toContain('[FAQ](https://shop.example/p/faq.html)');
  });

  it('reports which main-content strategy was used', () => {
    expect(strategy).toBe('readability');
  });
});

describe('htmlToMarkdown fallbacks', () => {
  const items = Array.from({ length: 12 }, (_, i) => `<li><a href="/item/${i}">Item number ${i}</a> £${i + 1}.00</li>`).join('');
  const listing = `<html><head><title>Listing</title></head><body><ul>${items}</ul></body></html>`;

  it('keeps every item of a listing page', () => {
    const result = htmlToMarkdown(listing, 'https://shop.example/list');
    for (let i = 0; i < 12; i++) expect(result.markdown).toContain(`Item number ${i}`);
  });

  it('falls back to the cleaned body when Readability coverage is below the threshold', () => {
    const result = htmlToMarkdown(listing, 'https://shop.example/list', { minCoverage: 1.01 });
    expect(result.strategy).toBe('body');
    expect(result.markdown).toContain('Item number 11');
  });

  it('returns just the title for an empty body instead of throwing', () => {
    const result = htmlToMarkdown('<html><head><title>Empty</title></head><body></body></html>', 'https://x.example/');
    expect(result.markdown).toBe('# Empty\n');
  });
});
