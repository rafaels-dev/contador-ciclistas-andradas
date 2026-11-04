import type { Metadata } from "next";
import { Barlow, Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { LEGACY_STORAGE, moveStorageKeys } from "@/lib/legacy-storage";
import { DocumentLang } from "./_shell/document-lang";
import { Library } from "./_shell/library";
import { StatusBar } from "./_shell/status-bar";
import { TitleBar } from "./_shell/title-bar";
import { Update } from "./_shell/update";
import "./globals.css";

// Barlow was born from California highway signs — it suits the subject
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"] });
const barlowCondensed = Barlow_Semi_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin", "latin-ext"], weight: ["500", "600"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin", "latin-ext"], weight: ["400", "500"] });

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const t = await getTranslations("app");
  return { title: t("name"), description: t("description") };
}

// before the first paint: the saved theme (otherwise follows the system) and,
// in the desktop app, the platform — the title bar leaves room for the window
// buttons. Moves the localStorage keys from before 0.0.8 (contador:*).
const INITIAL_SCRIPT = `(function(){try{var s=localStorage;(${moveStorageKeys.toString()})(s,${JSON.stringify(LEGACY_STORAGE)});var d=document.documentElement,t=s.getItem("tc:theme");if(t==="dark"||t==="light")d.setAttribute("data-theme",t);var p=window.trafficCounterDesktop&&window.trafficCounterDesktop.platform;if(p)d.setAttribute("data-desktop",p)}catch(e){}})()`;

/** Everything that depends on the language (setting or computer): read per request. */
async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DocumentLang locale={locale} />
      <TitleBar />
      <Suspense fallback={null}>
        <Update />
      </Suspense>
      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<aside className="w-60 shrink-0 border-r border-line bg-panel" />}>
          <Library />
        </Suspense>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
      <Suspense fallback={<footer className="h-7 border-t border-line bg-panel" />}>
        <StatusBar />
      </Suspense>
    </NextIntlClientProvider>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: INITIAL_SCRIPT }} />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-app font-sans text-fg">
        <Suspense fallback={<header className="h-10 shrink-0 border-b border-line bg-panel" />}>
          <Shell>{children}</Shell>
        </Suspense>
      </body>
    </html>
  );
}
