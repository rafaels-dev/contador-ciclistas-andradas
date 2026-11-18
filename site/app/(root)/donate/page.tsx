import { DonatePage } from "@/components/Subpages";
import { pageMetadata } from "@/lib/metadata";
import { DEFAULT_LOCALE, loadMessages } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata(DEFAULT_LOCALE, await loadMessages(DEFAULT_LOCALE), "donate");
}

export default async function Page() {
  return <DonatePage locale={DEFAULT_LOCALE} t={await loadMessages(DEFAULT_LOCALE)} />;
}
