import type { Metadata } from "next";
import { Barlow, Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import { BarraStatus } from "./_shell/barra-status";
import { BarraTitulo } from "./_shell/barra-titulo";
import { Atualizacao } from "./_shell/atualizacao";
import { Biblioteca } from "./_shell/biblioteca";
import "./globals.css";

// Barlow nasceu das placas das rodovias da Califórnia — combina com o assunto
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowCondensed = Barlow_Semi_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["500", "600"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Contador de tráfego",
  description: "Detecção, sugestão e revisão humana de contagens de tráfego",
};

// antes da 1ª pintura: tema salvo (senão segue o sistema) e, no app desktop,
// a plataforma — a barra de título deixa espaço para os botões da janela
const SCRIPT_INICIAL = `(function(){try{var d=document.documentElement,t=localStorage.getItem("contador:tema");if(t==="dark"||t==="light")d.setAttribute("data-theme",t);var p=window.contadorDesktop&&window.contadorDesktop.plataforma;if(p)d.setAttribute("data-desktop",p)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_INICIAL }} />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-app font-sans text-fg">
        <BarraTitulo />
        <Suspense fallback={null}>
          <Atualizacao />
        </Suspense>
        <div className="flex min-h-0 flex-1">
          <Suspense fallback={<aside className="w-60 shrink-0 border-r border-line bg-panel" />}>
            <Biblioteca />
          </Suspense>
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
        </div>
        <Suspense fallback={<footer className="h-7 border-t border-line bg-panel" />}>
          <BarraStatus />
        </Suspense>
      </body>
    </html>
  );
}
