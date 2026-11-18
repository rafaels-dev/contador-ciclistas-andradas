import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Document } from "@/components/Document";
import { DEFAULT_LOCALE, LOCALES, localeFromSegment } from "@/lib/site";

type Params = { params: Promise<{ locale: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => ({ locale: l.toLowerCase() }));
}

export default async function Layout({ children, params }: Params & { children: ReactNode }) {
  const locale = localeFromSegment((await params).locale);
  if (!locale) notFound();
  return <Document locale={locale}>{children}</Document>;
}
