import { notFound } from "next/navigation";
import { ContributorsPage } from "@/components/Subpages";
import { pageMetadata } from "@/lib/metadata";
import { loadMessages, localeFromSegment } from "@/lib/site";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params) {
  const locale = localeFromSegment((await params).locale);
  return locale ? pageMetadata(locale, await loadMessages(locale), "contributors") : {};
}

export default async function Page({ params }: Params) {
  const locale = localeFromSegment((await params).locale);
  if (!locale) notFound();
  return <ContributorsPage locale={locale} t={await loadMessages(locale)} />;
}
