import type { Metadata } from "next";
import { LOCALES, type Locale, type Messages, type PageSlug, SITE_URL, pagePath } from "./site";

/** Title, description and the hreflang alternates of one page in one language. */
export function pageMetadata(locale: Locale, t: Messages, page: PageSlug = ""): Metadata {
  const title = page ? `${t[page].title} | counter.bike` : t.meta.title;
  const description = page ? t[page].lead : t.meta.description;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: {
      canonical: pagePath(locale, page),
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, pagePath(l, page)])),
        "x-default": pagePath("en", page),
      },
    },
    openGraph: {
      title,
      description,
      url: pagePath(locale, page),
      siteName: "counter.bike",
      locale: locale.replace("-", "_"),
      type: "website",
      images: [{ url: "/shots/review-dark.webp" }],
    },
  };
}
