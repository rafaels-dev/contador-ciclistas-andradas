"use client";

import { useActionState } from "react";
import { criarJobsDaPasta, novoJob, type EstadoNovoJob } from "./actions";

export function FormNovoJob() {
  const [estado, acao, enviando] = useActionState<EstadoNovoJob, FormData>(novoJob, {});

  return (
    <div className="flex flex-col gap-4">
      <form action={acao} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="link"
          required
          placeholder="Link de um vídeo ou de uma pasta do Google Drive"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          disabled={enviando}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {enviando ? "Abrindo…" : "Processar"}
        </button>
        {estado.erro && <p className="text-sm text-red-600 sm:basis-full">{estado.erro}</p>}
      </form>

      {estado.pasta && (
        <form
          key={estado.pasta.id}
          action={criarJobsDaPasta}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <p className="text-sm font-medium">{estado.pasta.arquivos.length} vídeo(s) na pasta — marque quais processar:</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {estado.pasta.arquivos.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="arquivo" value={`${a.id}|${a.nome}`} />
                  {a.nome}
                </label>
              </li>
            ))}
          </ul>
          <button className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            Criar jobs dos marcados
          </button>
        </form>
      )}
    </div>
  );
}
