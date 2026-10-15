/**
 * DOM-level cleanup that runs before main-content detection. Everything here mutates
 * the given document in place.
 */

/** Elements that never carry content an agent needs. */
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas', 'link', 'meta',
  'nav', 'footer', 'aside', 'form', 'button', 'input', 'select', 'textarea',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="dialog"]',
  '[aria-hidden="true"]', '[hidden]',
];

/** id/class fragments typical of cookie/consent banners and other overlays. */
const OVERLAY_PATTERN = /(cookie|consent|gdpr|onetrust|cc-banner|newsletter-popup|modal-backdrop)/i;

export function removeNoise(doc: Document): number {
  let removed = 0;
  for (const el of doc.querySelectorAll(NOISE_SELECTORS.join(','))) {
    el.remove();
    removed++;
  }
  for (const el of doc.body?.querySelectorAll('[id],[class]') ?? []) {
    const signature = `${el.id} ${el.getAttribute('class') ?? ''}`;
    if (OVERLAY_PATTERN.test(signature) && el.isConnected) {
      el.remove();
      removed++;
    }
  }
  return removed;
}

/** Rewrite relative hrefs to absolute so links survive outside the original page. */
export function absolutizeLinks(doc: Document): void {
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || /^javascript:/i.test(href)) {
      a.removeAttribute('href');
      continue;
    }
    a.setAttribute('href', a.href); // jsdom resolves against the document URL
  }
  for (const img of doc.querySelectorAll<HTMLImageElement>('img[src]')) {
    img.setAttribute('src', img.src);
  }
}

/**
 * GFM tables require a header row. Key/value tables (rows of <th>label</th><td>value</td>)
 * have none, and turndown-plugin-gfm then leaves them as raw HTML. Give such tables a
 * synthetic header so they convert to real Markdown tables.
 */
export function normalizeTables(doc: Document): number {
  let fixed = 0;
  for (const table of doc.querySelectorAll('table')) {
    const rows = Array.from(table.rows);
    const first = rows[0];
    if (!first) continue;
    const firstIsHeader = Array.from(first.cells).every((c) => c.tagName === 'TH');
    if (firstIsHeader) continue;

    const width = Math.max(...rows.map((r) => r.cells.length));
    const isKeyValue = width === 2 && rows.every((r) => r.cells[0]?.tagName === 'TH');
    const labels = isKeyValue ? ['Field', 'Value'] : Array.from({ length: width }, () => '');

    const thead = doc.createElement('thead');
    const tr = doc.createElement('tr');
    for (const label of labels) {
      const th = doc.createElement('th');
      th.textContent = label;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.insertBefore(thead, table.firstChild);
    // Row-header cells would otherwise render as bold-less plain text anyway; make them <td>
    // so every body row has a uniform shape.
    for (const th of table.querySelectorAll('tbody th')) {
      const td = doc.createElement('td');
      td.innerHTML = th.innerHTML;
      th.replaceWith(td);
    }
    fixed++;
  }
  return fixed;
}
