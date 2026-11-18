import { DownloadPage } from "@/components/Subpages";
import { pageMetadata } from "@/lib/metadata";
import { latestRelease } from "@/lib/release";
import { DEFAULT_LOCALE, loadMessages } from "@/lib/site";

export async function generateMetadata() {
  return pageMetadata(DEFAULT_LOCALE, await loadMessages(DEFAULT_LOCALE), "download");
}

export default async function Page() {
  return <DownloadPage locale={DEFAULT_LOCALE} t={await loadMessages(DEFAULT_LOCALE)} release={await latestRelease()} />;
}
