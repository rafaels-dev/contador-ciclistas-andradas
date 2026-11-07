import type { Category } from "./db";

/**
 * "Passages only" mode of the final video: instead of the whole recording,
 * `before_s` ahead of each counted object of `categories` (null = all
 * categories in the video) to `after_s` after it. The counter still adds
 * everything (worker/render.py). Stored as JSON in renders.highlights;
 * null = the whole video.
 */
export type Highlights = { before_s: number; after_s: number; categories: Category[] | null };

export const HIGHLIGHT_DEFAULT = { before_s: 2.5, after_s: 2.5 } as const;
export const HIGHLIGHT_MIN_S = 0.5;
export const HIGHLIGHT_MAX_S = 30;

const seconds = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= HIGHLIGHT_MIN_S && v <= HIGHLIGHT_MAX_S ? Math.round(v * 10) / 10 : null;

/** Checked copy of a choice from the screen (undefined = invalid). */
export function validHighlights(value: unknown, categories: readonly Category[]): Highlights | null | undefined {
  if (value == null) return null;
  if (typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const before = seconds(v.before_s);
  const after = seconds(v.after_s);
  if (before == null || after == null) return undefined;
  if (v.categories == null) return { before_s: before, after_s: after, categories: null };
  if (!Array.isArray(v.categories)) return undefined;
  const cats = categories.filter((c) => (v.categories as unknown[]).includes(c));
  if (!cats.length) return undefined;
  return { before_s: before, after_s: after, categories: cats.length === categories.length ? null : cats };
}

export function parseHighlights(json: string | null): Highlights | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Highlights;
  } catch {
    return null;
  }
}
