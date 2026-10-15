import { z } from 'zod';
import type { Template } from '../template.js';

/**
 * Product detail page template. Selectors follow books.toscrape.com's markup; the local
 * demo shop uses the same markup, so this one template works on both.
 */
export const ProductSchema = z.object({
  title: z.string().min(1),
  price: z.number().positive(),
  currency: z.string().length(3),
  inStock: z.boolean(),
  stockCount: z.number().int().nonnegative().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  upc: z.string().nullable(),
  category: z.string().nullable(),
});

export type Product = z.infer<typeof ProductSchema>;

const RATINGS: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };
const CURRENCIES: Record<string, string> = { '£': 'GBP', $: 'USD', '€': 'EUR' };

const text = (doc: Document, selector: string) => doc.querySelector(selector)?.textContent?.trim() || null;

export const productTemplate: Template<Product> = {
  name: 'product',
  schema: ProductSchema,
  requiredFields: ['title', 'price'],

  extract(doc) {
    const priceText = text(doc, '.product_main .price_color');
    const availability = text(doc, '.product_main .availability') ?? '';
    const ratingClass = doc.querySelector('.product_main .star-rating')?.classList;
    const ratingWord = ratingClass ? Array.from(ratingClass).find((c) => c in RATINGS) : undefined;

    return {
      title: text(doc, '.product_main h1'),
      price: priceText ? Number.parseFloat(priceText.replace(/[^\d.]/g, '')) : null,
      currency: priceText ? (CURRENCIES[priceText.trim().charAt(0)] ?? null) : null,
      inStock: availability ? /in stock/i.test(availability) : null,
      stockCount: Number.parseInt(availability.match(/\((\d+) available\)/)?.[1] ?? '', 10) || null,
      rating: ratingWord ? (RATINGS[ratingWord] ?? null) : null,
      upc: tableValue(doc, 'UPC'),
      category: text(doc, '.breadcrumb li:nth-last-child(2) a'),
    };
  },
};

function tableValue(doc: Document, label: string): string | null {
  for (const row of doc.querySelectorAll('table tr')) {
    if (row.querySelector('th')?.textContent?.trim() === label) return row.querySelector('td')?.textContent?.trim() ?? null;
  }
  return null;
}
