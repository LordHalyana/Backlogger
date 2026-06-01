import { z } from 'zod';

/**
 * A single normalized tag.
 * Transform pipeline: trim → lowercase → collapse spaces to hyphens.
 * Refine: must match kebab-case and be 1–50 chars after transformation.
 */
export const TagSchema = z
  .string()
  .min(1)
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
  .refine((s) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(s), {
    message: 'tag must be lowercase kebab-case, 1–50 chars, start with a letter or digit',
  });

/**
 * Normalize and deduplicate an array of raw tag strings.
 * Silently drops any entry that fails validation rather than throwing.
 */
export function normalizeTags(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const result = TagSchema.safeParse(raw);
    if (result.success && !seen.has(result.data)) {
      seen.add(result.data);
      out.push(result.data);
    }
  }
  return out;
}
