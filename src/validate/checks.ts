import type { Draft, Template } from '../extract/template.js';

export type Status = 'ok' | 'partial' | 'blocked' | 'failed';

export interface Validation<T> {
  status: Status;
  reasons: string[];
  data: Draft<T> | null;
}

const BLOCK_KEYWORDS = /captcha|are you a robot|verify you are human|access denied|unusual traffic/i;

/** Heuristic: is this a bot-wall page rather than real content? */
export function detectBlocked(doc: Document): string | null {
  const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const match = `${doc.title} ${bodyText}`.match(BLOCK_KEYWORDS);
  if (match) return `block keyword: "${match[0]}"`;
  if (bodyText.length < 50) return `body is nearly empty (${bodyText.length} chars)`;
  return null;
}

/**
 * Turns a raw extraction into a verdict. The point is to never return bad data silently:
 * every result says ok / partial / blocked / failed and why.
 */
export function validate<T>(doc: Document, template: Template<T>): Validation<T> {
  const blocked = detectBlocked(doc);
  if (blocked) return { status: 'blocked', reasons: [blocked], data: null };

  let data: Draft<T>;
  try {
    data = template.extract(doc);
  } catch (err) {
    return { status: 'failed', reasons: [`extractor threw: ${(err as Error).message}`], data: null };
  }

  const missing = template.requiredFields.filter((f) => data[f] === null);
  if (missing.length === template.requiredFields.length) {
    return { status: 'failed', reasons: ['no required fields found (template does not match this page?)'], data };
  }

  const reasons = missing.map((f) => `missing required field: ${f}`);
  const parsed = template.schema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      if (!missing.includes(field as keyof T & string)) reasons.push(`${field}: ${issue.message}`);
    }
  }
  return { status: reasons.length ? 'partial' : 'ok', reasons, data };
}
