"use client";

import { useEffect, useSyncExternalStore } from "react";

type Tema = "dark" | "light";

const CHAVE = "contador:tema";

function temaAtual(): Tema {
  const d = document.documentElement.getAttribute("data-theme");
  if (d === "dark" || d === "light") return d;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const ouvintes = new Set<() => void>();
function assinar(f: () => void) {
  ouvintes.add(f);
  const mq = matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", f);
  return () => {
    ouvintes.delete(f);
    mq.removeEventListener("change", f);
  };
}

/** Alterna entre o tema escuro e o claro; a escolha fica salva neste computador. */
export function BotaoTema() {
  const tema = useSyncExternalStore<Tema | null>(assinar, temaAtual, () => null);
  const proximo: Tema = tema === "light" ? "dark" : "light";

  // app desktop: os botões da janela acompanham o tema da página
  useEffect(() => {
    const desktop = window.contadorDesktop;
    if (!desktop) return;
    document.documentElement.setAttribute("data-desktop", desktop.plataforma);
    if (tema) desktop.tema?.(tema);
  }, [tema]);

  function trocar() {
    document.documentElement.setAttribute("data-theme", proximo);
    try {
      localStorage.setItem(CHAVE, proximo);
    } catch {}
    window.contadorDesktop?.tema?.(proximo);
    ouvintes.forEach((f) => f());
  }

  return (
    <button
      type="button"
      onClick={trocar}
      className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
      aria-label={tema ? `Usar tema ${proximo === "light" ? "claro" : "escuro"}` : "Trocar tema"}
      title="Trocar tema claro/escuro"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
      </svg>
      {tema === null ? "Tema" : tema === "light" ? "Claro" : "Escuro"}
    </button>
  );
}
