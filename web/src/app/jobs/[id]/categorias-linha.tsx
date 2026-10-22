"use client";

import { useTransition } from "react";
import type { Categoria, Linha } from "@/lib/db";
import { NOME_CATEGORIA } from "@/lib/revisao";
import { definirCategoriasLinhas } from "./actions";

const TODAS: Categoria[] = ["ciclistas", "patinetes", "scooters", "pedestres", "motocicletas", "automoveis"];

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
            className={`rounded-full px-2 py-0.5 text-xs ${
              on ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800"
            }`}
          >
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
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="text-zinc-600 dark:text-zinc-400">
        O que cada linha conta — o que o modelo sugerir fora disso chega já proposto como descarte (você pode reverter).
        {salvando && " Salvando…"}
      </p>
      {linhas.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-3">
          <span className="min-w-32 font-medium">{l.nome}</span>
          <ChipsCategorias
            valor={l.categorias}
            rotulo={`Categorias da linha ${l.nome}`}
            aoMudar={(v) => iniciar(() => definirCategoriasLinhas(jobId, { [l.id]: v ?? [] }))}
          />
        </div>
      ))}
    </div>
  );
}
