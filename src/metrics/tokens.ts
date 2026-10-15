import { getEncoding, type Tiktoken } from 'js-tiktoken';

/**
 * Token counts use OpenAI's o200k_base encoding as a stand-in: it runs offline and is a
 * reasonable proxy for modern LLM tokenizers. Absolute counts for Claude will differ;
 * the HTML-vs-Markdown *ratio* is what matters here.
 */
let encoder: Tiktoken | undefined;

export function countTokens(text: string): number {
  encoder ??= getEncoding('o200k_base');
  return encoder.encode(text).length;
}

export const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');
