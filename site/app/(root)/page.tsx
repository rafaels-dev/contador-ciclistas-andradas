import { Page } from "@/components/Page";
import { pageMetadata } from "@/lib/metadata";
import { DEFAULT_LOCALE, loadMessages } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata(DEFAULT_LOCALE, await loadMessages(DEFAULT_LOCALE));
}

export default async function Home() {
  return <Page locale={DEFAULT_LOCALE} t={await loadMessages(DEFAULT_LOCALE)} />;
}
