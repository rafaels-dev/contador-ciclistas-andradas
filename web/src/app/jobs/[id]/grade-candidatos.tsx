"use client";

import { useState } from "react";
import type { Candidato, Categoria } from "@/lib/db";

export const NOME_CATEGORIA: Record<Categoria, string> = {
  ciclistas: "Ciclista",
  pedestres: "Pedestre",
  automoveis: "Automóvel",
  motocicletas: "Motocicleta",
};

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

type Props = { base: string; candidatos: Candidato[]; nomesLinhas: Record<string, string> };

export function GradeCandidatos({ base, candidatos, nomesLinhas }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Categoria | "todos">("todos");
  const visiveis = filtro === "todos" ? candidatos : candidatos.filter((c) => c.classe_yolo === filtro);
  const contagem = (cat: Categoria) => candidatos.filter((c) => c.classe_yolo === cat).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {(["todos", "ciclistas", "pedestres", "automoveis", "motocicletas"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1 ${filtro === f ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}
          >
            {f === "todos" ? `Todos (${candidatos.length})` : `${NOME_CATEGORIA[f]} (${contagem(f)})`}
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visiveis.map((c) => (
          <li key={c.id} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <button className="block w-full bg-black" onClick={() => setAberto(aberto === c.id ? null : c.id)} title="Ver clipe">
              {aberto === c.id && c.clipe ? (
                <video src={`${base}/${c.clipe}`} autoPlay loop muted playsInline className="mx-auto max-h-64" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${base}/${c.filmstrip}`} alt={`Candidato ${c.id}`} loading="lazy" className="mx-auto h-28 object-contain" />
              )}
            </button>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium">{c.classe_yolo ? NOME_CATEGORIA[c.classe_yolo] : "?"}</span>
              {c.alternativa && <span className="text-zinc-500">ou {NOME_CATEGORIA[c.alternativa]}</span>}
              <span className="text-zinc-500">{mmss(c.tempo_s)}</span>
              {c.linha_id && (
                <span className="text-zinc-500">
                  {nomesLinhas[c.linha_id] ?? c.linha_id} {c.direcao}
                </span>
              )}
              {c.origem && c.origem !== "track" && <span className="text-amber-600">{c.origem.replaceAll("_", " ")}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
