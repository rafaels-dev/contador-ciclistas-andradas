import { notFound } from "next/navigation";
import { Page } from "@/components/Page";
import { pageMetadata } from "@/lib/metadata";
import { loadMessages, localeFromSegment } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFromSegment((await params).locale);
  return locale ? pageMetadata(locale, await loadMessages(locale)) : {};
}

export default async function LocalizedHome({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFromSegment((await params).locale);
  if (!locale) notFound();
  return <Page locale={locale} t={await loadMessages(locale)} />;
}
