"use client";

import { useState, useTransition } from "react";
import { gerarVideoFinal } from "./renders/actions";

export type OpcaoVideo = { id: string; nome: string; motivo: string | null; contagens: number };

/**
 * Escolha dos vídeos do vídeo final, na ordem em que entram (o contador soma
 * entre eles). Só vídeos com a revisão completa podem ser marcados.
 */
export function SeletorVideoFinal({ opcoes }: { opcoes: OpcaoVideo[] }) {
  const [ordem, setOrdem] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const porId = Object.fromEntries(opcoes.map((o) => [o.id, o]));
  const prontos = opcoes.filter((o) => !o.motivo);

  const alternar = (id: string) =>
    setOrdem((o) => {
      if (o.includes(id)) return o.filter((x) => x !== id);
      // entra na posição pelo nome do arquivo (00h, 02h…) — dá para mudar com ↑/↓
      const nova = [...o, id];
      return nova.sort((a, b) => porId[a].nome.localeCompare(porId[b].nome, "pt-BR", { numeric: true }));
    });
  const mover = (i: number, d: number) =>
    setOrdem((o) => {
      const n = [...o];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  if (!opcoes.length) return <p className="text-zinc-500">Nenhum vídeo revisado ainda.</p>;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <ul className="flex flex-col gap-1 text-sm">
        {opcoes.map((o) => (
          <li key={o.id}>
            <label className={`flex items-center gap-2 ${o.motivo ? "text-zinc-400" : "cursor-pointer"}`}>
              <input type="checkbox" disabled={!!o.motivo} checked={ordem.includes(o.id)} onChange={() => alternar(o.id)} />
              <span className="truncate">{o.nome}</span>
              <span className="shrink-0 text-xs text-zinc-500">{o.motivo ?? `${o.contagens} contagens`}</span>
            </label>
          </li>
        ))}
      </ul>

      {ordem.length > 1 && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-zinc-600 dark:text-zinc-400">Ordem no vídeo final:</p>
          <ol className="flex flex-col gap-1">
            {ordem.map((id, i) => (
              <li key={id} className="flex items-center gap-2">
                <span className="w-5 text-right text-zinc-500">{i + 1}.</span>
                <span className="flex-1 truncate">{porId[id].nome}</span>
                <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} className="rounded px-2 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label={`Subir ${porId[id].nome}`}>↑</button>
                <button type="button" disabled={i === ordem.length - 1} onClick={() => mover(i, 1)} className="rounded px-2 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label={`Descer ${porId[id].nome}`}>↓</button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={!ordem.length || pendente}
          onClick={() => iniciar(async () => setErro((await gerarVideoFinal(ordem)).erro ?? null))}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {ordem.length > 1 ? `Gerar vídeo final com ${ordem.length} vídeos` : "Gerar vídeo final"}
        </button>
        {!prontos.length && <span className="text-sm text-zinc-500">Termine a revisão de algum vídeo para liberar.</span>}
        {erro && <span className="text-sm text-red-600">{erro}</span>}
      </div>
    </div>
  );
}
