import { createTranslator } from "use-intl/core";
import { readSetting } from "@/lib/db";
import { DEFAULT_LOCALE, isLocale, matchLocale, type Locale } from "./locales";

/**
 * The app language without a request (background work: final video texts,
 * the vision-model prompt). Chosen in Settings, otherwise the computer's
 * language — the desktop app passes the system's preferred languages in
 * TRAFFIC_COUNTER_SYSTEM_LOCALES —, otherwise English.
 */
export function appLocale(): Locale {
  return chosenLocale() ?? systemLocale() ?? DEFAULT_LOCALE;
}

/** The language picked in Settings (null = follow the computer). */
export function chosenLocale(): Locale | null {
  try {
    const v = readSetting("language");
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function systemLocale(): Locale | null {
  return matchLocale((process.env.TRAFFIC_COUNTER_SYSTEM_LOCALES ?? "").split(","));
}

export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  return (await import(`../../messages/${locale}.json`)).default;
}

export type LooseTranslator = (key: string, values?: Record<string, string | number>) => string;

/** Translator for code outside React (runner, final video plan); keys are checked by the message tests, not by types. */
export async function translatorFor(locale: Locale = appLocale()): Promise<LooseTranslator> {
  const messages = await loadMessages(locale);
  return createTranslator({ locale, messages }) as unknown as LooseTranslator;
}
