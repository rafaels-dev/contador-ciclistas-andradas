/**
 * Languages of the app. Besides Portuguese (where the project started),
 * English, Spanish and French, the languages of countries investing in active
 * mobility (bike lanes, counting programs): German, Dutch, Italian, Danish.
 * Adding one: a messages/<code>.json with every key of en.json, an entry
 * here and the prompt in lib/prompts.ts.
 */
export const LOCALES = ["en", "pt-BR", "es", "fr", "de", "nl", "it", "da"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Each language in its own language (the picker shows them like this). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
  it: "Italiano",
  da: "Dansk",
};

/** Setting value meaning "follow the computer's language". */
export const SYSTEM_LOCALE = "system";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * First supported language in a preference list ("pt-PT", "de-AT", "en-US"…):
 * exact match first, then the base language (any Portuguese → pt-BR).
 */
export function matchLocale(preferred: readonly string[]): Locale | null {
  for (const raw of preferred) {
    const tag = raw.trim();
    if (!tag) continue;
    const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = tag.split(/[-_]/)[0].toLowerCase();
    const byBase = LOCALES.find((l) => l.split("-")[0] === base);
    if (byBase) return byBase;
  }
  return null;
}

/** Accept-Language header → tags ordered by preference (q). */
export function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { tag, q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}
