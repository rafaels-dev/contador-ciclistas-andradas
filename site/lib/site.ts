import type en from "@/messages/en.json";

export type Messages = typeof en;

/** Same languages as the app (web/src/i18n/locales.ts). */
export const LOCALES = ["en", "pt-BR", "es", "fr", "de", "nl", "it", "da"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
  it: "Italiano",
  da: "Dansk",
};

/** English lives at the root; every other language under its lowercase code. */
export function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/" : `/${locale.toLowerCase()}/`;
}

/** The sub-pages every language has. "" is the home page. */
export const PAGES = ["", "download", "credits", "donate"] as const;
export type PageSlug = (typeof PAGES)[number];

export function pagePath(locale: Locale, page: PageSlug): string {
  return localePath(locale) + (page ? page + "/" : "");
}

export function localeFromSegment(segment: string): Locale | undefined {
  return LOCALES.find((l) => l !== DEFAULT_LOCALE && l.toLowerCase() === segment);
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await import(`@/messages/${locale}.json`)).default as Messages;
}

export const SITE_URL = "https://counter.bike";
/** The repository keeps its first name until it moves; every link goes through here. */
export const REPO = "https://github.com/rafaels-dev/counter-bike";
export const LINKS = {
  repo: REPO,
  releases: `${REPO}/releases`,
  issues: `${REPO}/issues`,
  licence: `${REPO}/blob/HEAD/LICENSE`,
  languages: `${REPO}/tree/HEAD/web/messages`,
};

/**
 * Counts made by hand vs. what detection found before any review
 * (validation runs recorded in CLAUDE.md, Nov/2026). Same order as `checked.rows`.
 */
export const CHECKED: { hand: number; software: number }[] = [
  { hand: 70, software: 63 },
  { hand: 85, software: 60 },
  { hand: 171, software: 185 },
  { hand: 35, software: 29 },
];

/** Key in localStorage for the language the visitor picked. */
export const LANGUAGE_KEY = "cb:language";

/**
 * Where donations go. With an empty list (no channel open) the donate page
 * then says so instead of showing a button that leads nowhere.
 */
export const DONATE: { name: string; url: string }[] = [
  { name: "GitHub Sponsors", url: "https://github.com/sponsors/rafaels-dev" },
];
