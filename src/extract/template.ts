import type { ZodType } from 'zod';

/** Raw extraction output: every field may be missing on a broken page. */
export type Draft<T> = { [K in keyof T]: T[K] | null };

/** A reusable recipe for one page type: selectors in, typed JSON out. No LLM per page. */
export interface Template<T> {
  name: string;
  schema: ZodType<T>;
  requiredFields: (keyof T & string)[];
  extract(doc: Document): Draft<T>;
}
