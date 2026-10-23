"use client";

import { useState, useTransition } from "react";
import { criarJobsLocais, navegarPasta, type EstadoPasta } from "./actions";

const CHAVE_ULTIMA = "contador:ultima-pasta";

function tamanho(bytes = 0): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : `${Math.round(bytes / 1e6)} MB`;
}

/** Escolhe vídeos que já estão no computador — o app os lê onde estão, sem copiar. */
export function SeletorLocal() {
  const [estado, setEstado] = useState<EstadoPasta | null>(null);
  const [digitado, setDigitado] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [ocupado, iniciar] = useTransition();

  function abrir(caminho: string | null) {
    iniciar(async () => {
      const novo = await navegarPasta(caminho);
      setEstado(novo);
      if (novo.conteudo) {
        setDigitado(novo.conteudo.caminho);
        setMarcados(novo.selecionado ? [novo.selecionado] : []);
        try {
          localStorage.setItem(CHAVE_ULTIMA, novo.conteudo.caminho);
        } catch {}
      }
    });
  }

  if (!estado) {
    return (
      <button
        type="button"
        onClick={() => {
          let ultima: string | null = null;
          try {
            ultima = localStorage.getItem(CHAVE_ULTIMA);
          } catch {}
          abrir(ultima);
        }}
        className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {ocupado ? "Abrindo…" : "Escolher vídeo do computador…"}
      </button>
    );
  }

  const c = estado.conteudo;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" data-testid="seletor-local">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Vídeos do computador — usados onde estão, sem copiar</p>
        <button type="button" onClick={() => setEstado(null)} className="text-sm text-zinc-500 hover:underline">
          Fechar
        </button>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          abrir(digitado);
        }}
      >
        <input
          value={digitado}
          onChange={(e) => setDigitado(e.target.value)}
          aria-label="Caminho da pasta ou do vídeo"
          placeholder="Cole o caminho de uma pasta ou de um vídeo"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">Ir</button>
      </form>

      <div className="flex flex-wrap gap-1">
        {estado.raizes.map((r) => (
          <button
            key={r.caminho}
            type="button"
            onClick={() => abrir(r.caminho)}
            className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            {r.nome}
          </button>
        ))}
      </div>

      {estado.erro && <p className="text-sm text-red-600">{estado.erro}</p>}

      {c && (
        <ul className={`max-h-80 overflow-y-auto rounded border border-zinc-200 text-sm dark:border-zinc-800 ${ocupado ? "opacity-50" : ""}`}>
          {c.pai && (
            <li>
              <button type="button" onClick={() => abrir(c.pai)} className="w-full px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                ↑ Pasta acima
              </button>
            </li>
          )}
          {c.pastas.map((p) => (
            <li key={p.caminho}>
              <button type="button" onClick={() => abrir(p.caminho)} className="w-full truncate px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                📁 {p.nome}
              </button>
            </li>
          ))}
          {c.videos.map((v) => (
            <li key={v.caminho}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <input
                  type="checkbox"
                  checked={marcados.includes(v.caminho)}
                  onChange={(e) => setMarcados((m) => (e.target.checked ? [...m, v.caminho] : m.filter((x) => x !== v.caminho)))}
                />
                <span className="flex-1 truncate">🎬 {v.nome}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">{tamanho(v.bytes)}</span>
              </label>
            </li>
          ))}
          {!c.pastas.length && !c.videos.length && <li className="px-3 py-1.5 text-zinc-500">Nenhum vídeo nem pasta aqui.</li>}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!marcados.length || ocupado}
          onClick={() => iniciar(() => criarJobsLocais(marcados))}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Processar {marcados.length || ""} vídeo{marcados.length === 1 ? "" : "s"}
        </button>
        {c && c.videos.length > 1 && (
          <button
            type="button"
            onClick={() => setMarcados(marcados.length === c.videos.length ? [] : c.videos.map((v) => v.caminho))}
            className="text-sm text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {marcados.length === c.videos.length ? "Desmarcar todos" : "Marcar todos desta pasta"}
          </button>
        )}
      </div>
    </div>
  );
}
