"use client";

import { useEffect, useSyncExternalStore } from "react";

type Tema = "dark" | "light";
/** "sistema" = sem escolha salva: segue o tema do computador */
type Escolha = "sistema" | Tema;

const CHAVE = "contador:tema";
const ORDEM: Escolha[] = ["sistema", "dark", "light"];
const NOME: Record<Escolha, string> = { sistema: "Sistema", dark: "Escuro", light: "Claro" };

function escolhaSalva(): Escolha {
  const d = document.documentElement.getAttribute("data-theme");
  return d === "dark" || d === "light" ? d : "sistema";
}

function temaDoSistema(): Tema {
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

/** Alterna Sistema → Escuro → Claro; a escolha fica salva neste computador. */
export function BotaoTema() {
  // "sistema|dark": a escolha e o tema efetivo numa string só (snapshot estável)
  const estado = useSyncExternalStore(assinar, () => `${escolhaSalva()}|${temaDoSistema()}`, () => null);
  const [escolha, sistema] = (estado?.split("|") ?? [null, null]) as [Escolha | null, Tema | null];
  const efetivo: Tema | null = escolha === "sistema" ? sistema : escolha;

  // app desktop: os botões da janela acompanham o tema da página
  useEffect(() => {
    const desktop = window.contadorDesktop;
    if (!desktop) return;
    document.documentElement.setAttribute("data-desktop", desktop.plataforma);
    if (efetivo) desktop.tema?.(efetivo);
  }, [efetivo]);

  function trocar() {
    const proxima = ORDEM[(ORDEM.indexOf(escolha ?? "sistema") + 1) % ORDEM.length];
    try {
      if (proxima === "sistema") localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, proxima);
    } catch {}
    if (proxima === "sistema") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", proxima);
    ouvintes.forEach((f) => f());
  }

  const rotulo = escolha === "sistema" && sistema ? `Sistema (${NOME[sistema].toLowerCase()})` : escolha ? NOME[escolha] : "Tema";
  return (
    <button
      type="button"
      onClick={trocar}
      className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
      aria-label={`Tema: ${rotulo}. Clique para trocar`}
      title="Tema: Sistema → Escuro → Claro"
      data-testid="botao-tema"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
      </svg>
      {rotulo}
    </button>
  );
}
