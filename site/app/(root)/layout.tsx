import type { ReactNode } from "react";
import { Document } from "@/components/Document";
import { DEFAULT_LOCALE } from "@/lib/site";

export default function Layout({ children }: { children: ReactNode }) {
  return <Document locale={DEFAULT_LOCALE}>{children}</Document>;
}
