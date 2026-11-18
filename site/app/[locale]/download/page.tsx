import { notFound } from "next/navigation";
import { DownloadPage } from "@/components/Subpages";
import { pageMetadata } from "@/lib/metadata";
import { latestRelease } from "@/lib/release";
import { loadMessages, localeFromSegment } from "@/lib/site";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params) {
  const locale = localeFromSegment((await params).locale);
  return locale ? pageMetadata(locale, await loadMessages(locale), "download") : {};
}

export default async function Page({ params }: Params) {
  const locale = localeFromSegment((await params).locale);
  if (!locale) notFound();
  return <DownloadPage locale={locale} t={await loadMessages(locale)} release={await latestRelease()} />;
}
