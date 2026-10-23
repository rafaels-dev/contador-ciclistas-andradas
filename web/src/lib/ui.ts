import type { Classe } from "./revisao";

/**
 * Peças visuais repetidas entre telas (classes Tailwind escritas por extenso
 * para o Tailwind encontrá-las no código).
 */

export const BOTAO = {
  primario:
    "inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40",
  secundario:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40",
  fantasma:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
  perigo:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-40",
} as const;

export const CAMPO =
  "rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none";

/** Cabeçalho de painel, no estilo dos editores (título curto à esquerda, ações à direita). */
export const TITULO_PAINEL = "font-display text-[0.8rem] font-semibold tracking-wide text-muted";

export const COR_CLASSE: Record<Classe, { fundo: string; texto: string; borda: string }> = {
  ciclistas: { fundo: "bg-cat-ciclistas", texto: "text-cat-ciclistas", borda: "border-cat-ciclistas" },
  pedestres: { fundo: "bg-cat-pedestres", texto: "text-cat-pedestres", borda: "border-cat-pedestres" },
  automoveis: { fundo: "bg-cat-automoveis", texto: "text-cat-automoveis", borda: "border-cat-automoveis" },
  motocicletas: { fundo: "bg-cat-motocicletas", texto: "text-cat-motocicletas", borda: "border-cat-motocicletas" },
  patinetes: { fundo: "bg-cat-patinetes", texto: "text-cat-patinetes", borda: "border-cat-patinetes" },
  scooters: { fundo: "bg-cat-scooters", texto: "text-cat-scooters", borda: "border-cat-scooters" },
  monociclos: { fundo: "bg-cat-monociclos", texto: "text-cat-monociclos", borda: "border-cat-monociclos" },
  outros: { fundo: "bg-cat-outros", texto: "text-cat-outros", borda: "border-cat-outros" },
  descartado: { fundo: "bg-cat-descartado", texto: "text-cat-descartado", borda: "border-cat-descartado" },
};

/** 471.3 → "7:51"; com horas quando passa de 1 h ("1:02:05"). */
export function timecode(s: number, horas = false): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h || horas ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
