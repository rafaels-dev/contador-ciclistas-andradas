"use client";

import { useTransition } from "react";
import type { Categoria, Linha } from "@/lib/db";
import { NOME_CATEGORIA } from "@/lib/revisao";
import { COR_CLASSE, TITULO_PAINEL } from "@/lib/ui";
import { definirCategoriasLinhas } from "./actions";

const TODAS: Categoria[] = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "motocicletas", "automoveis", "outros"];

/** Botões liga/desliga das categorias que uma linha conta (nenhuma desligada = todas). */
export function ChipsCategorias({ valor, aoMudar, rotulo }: { valor: Categoria[] | undefined; aoMudar: (v: Categoria[] | undefined) => void; rotulo: string }) {
  const ativas = valor?.length ? valor : TODAS;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={rotulo}>
      {TODAS.map((c) => {
        const on = ativas.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const nova = on ? ativas.filter((x) => x !== c) : [...ativas, c];
              if (!nova.length) return; // linha que não conta nada não faz sentido
              aoMudar(nova.length === TODAS.length ? undefined : TODAS.filter((x) => nova.includes(x)));
            }}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
              on ? "border-line bg-raised text-fg" : "border-transparent text-faint line-through"
            }`}
          >
            <span className={`h-2 w-2 rounded-sm ${on ? COR_CLASSE[c].fundo : "border border-faint"}`} />
            {NOME_CATEGORIA[c]}
          </button>
        );
      })}
    </div>
  );
}

/** Na revisão: muda o que cada linha conta sem refazer candidatos nem sugestões. */
export function CategoriasDasLinhas({ jobId, linhas }: { jobId: string; linhas: Linha[] }) {
  const [salvando, iniciar] = useTransition();
  if (!linhas.length) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line px-4 py-3 text-sm">
      <h2 className={TITULO_PAINEL}>O que cada linha conta {salvando && <span className="font-normal">· salvando…</span>}</h2>
      <p className="text-xs text-muted">Fora disso, a sugestão do modelo chega proposta como descarte (dá para reverter).</p>
      {linhas.map((l) => (
        <div key={l.id} className="flex flex-col gap-1">
          <span className="text-xs font-medium">{l.nome}</span>
          <ChipsCategorias
            valor={l.categorias}
            rotulo={`Categorias da linha ${l.nome}`}
            aoMudar={(v) => iniciar(() => definirCategoriasLinhas(jobId, { [l.id]: v ?? [] }))}
          />
        </div>
      ))}
    </section>
  );
}
