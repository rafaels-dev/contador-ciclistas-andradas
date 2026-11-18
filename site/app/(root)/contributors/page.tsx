import { ContributorsPage } from "@/components/Subpages";
import { pageMetadata } from "@/lib/metadata";
import { DEFAULT_LOCALE, loadMessages } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata(DEFAULT_LOCALE, await loadMessages(DEFAULT_LOCALE), "contributors");
}

export default async function Page() {
  return <ContributorsPage locale={DEFAULT_LOCALE} t={await loadMessages(DEFAULT_LOCALE)} />;
}
