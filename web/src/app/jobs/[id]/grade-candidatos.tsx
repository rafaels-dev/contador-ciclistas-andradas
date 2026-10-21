"use client";

import { useState } from "react";
import type { Candidato, Categoria } from "@/lib/db";

type Classe = Categoria | "descartado";

export const NOME_CATEGORIA: Record<Classe, string> = {
  ciclistas: "Ciclista",
  pedestres: "Pedestre",
  automoveis: "Automóvel",
  motocicletas: "Motocicleta",
  descartado: "Nada / descartar",
};

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Sugestão vigente: a do modelo de visão quando existe, senão a do detector. */
function sugestao(c: Candidato): Classe | null {
  return c.status_llm === "ok" ? c.sugestao_llm : c.classe_yolo;
}

type Props = { base: string; candidatos: Candidato[]; nomesLinhas: Record<string, string> };

export function GradeCandidatos({ base, candidatos, nomesLinhas }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Classe | "todos" | "divergentes">("todos");
  const divergente = (c: Candidato) => c.status_llm === "ok" && c.sugestao_llm !== c.classe_yolo;
  const visiveis = candidatos.filter((c) =>
    filtro === "todos" ? true : filtro === "divergentes" ? divergente(c) : sugestao(c) === filtro,
  );
  const contagem = (f: typeof filtro) =>
    f === "todos" ? candidatos.length : f === "divergentes" ? candidatos.filter(divergente).length : candidatos.filter((c) => sugestao(c) === f).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {(["todos", "ciclistas", "pedestres", "automoveis", "motocicletas", "descartado", "divergentes"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1 ${filtro === f ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
          >
            {f === "todos" ? "Todos" : f === "divergentes" ? "Modelo ≠ detector" : NOME_CATEGORIA[f]} ({contagem(f)})
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visiveis.map((c) => (
          <li key={c.id} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" data-testid="candidato">
            <button className="block w-full bg-black" onClick={() => setAberto(aberto === c.id ? null : c.id)} title="Ver clipe">
              {aberto === c.id && c.clipe ? (
                <video src={`${base}/${c.clipe}`} autoPlay loop muted playsInline className="mx-auto max-h-64" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${base}/${c.filmstrip}`} alt={`Candidato ${c.id}`} loading="lazy" className="mx-auto h-28 object-contain" />
              )}
            </button>
            <div className="flex flex-col gap-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {c.status_llm === "ok" && c.sugestao_llm ? (
                  <span className="font-medium">
                    {NOME_CATEGORIA[c.sugestao_llm]}{" "}
                    <span className="font-normal text-zinc-500">{Math.round((c.conf_llm ?? 0) * 100)}%</span>
                  </span>
                ) : c.status_llm === "falhou" ? (
                  <span className="font-medium text-red-600">Sugestão falhou</span>
                ) : (
                  <span className="text-zinc-500">Aguardando sugestão…</span>
                )}
                {divergente(c) && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-100">divergente</span>}
                <span className="text-zinc-500">{mmss(c.tempo_s)}</span>
                {c.linha_id && (
                  <span className="text-zinc-500">
                    {nomesLinhas[c.linha_id] ?? c.linha_id} {c.direcao}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500">
                Detector: {c.classe_yolo ? NOME_CATEGORIA[c.classe_yolo] : "?"}
                {c.alternativa && ` ou ${NOME_CATEGORIA[c.alternativa]}`}
                {c.origem && c.origem !== "track" && ` · ${c.origem.replaceAll("_", " ")}`}
              </div>
              {c.justificativa_llm && <p className="text-xs text-zinc-600 dark:text-zinc-400">{c.justificativa_llm}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
