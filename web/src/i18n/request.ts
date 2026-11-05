import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, matchLocale, parseAcceptLanguage } from "./locales";
import { chosenLocale, loadMessages, systemLocale } from "./server";

/**
 * Language of each page: the one chosen in Settings; otherwise the
 * computer's (from the desktop app, or the browser's Accept-Language when the
 * app runs in a browser); otherwise English. No locale in the URL: it is a
 * desktop app, the language is a preference.
 */
export default getRequestConfig(async () => {
  // always per request (also when a setting decides): a page that reads the
  // language outside <Suspense> must fail in development, not get prerendered
  // with the build-time language
  const accept = (await headers()).get("accept-language");
  const locale = chosenLocale() ?? systemLocale() ?? matchLocale(parseAcceptLanguage(accept)) ?? DEFAULT_LOCALE;
  return { locale, messages: await loadMessages(locale) };
});
