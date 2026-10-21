"use client";

import { useActionState } from "react";
import { novoJob, type EstadoNovoJob } from "./actions";

export function FormNovoJob() {
  const [estado, acao, enviando] = useActionState<EstadoNovoJob, FormData>(novoJob, {});

  return (
    <form action={acao} className="flex flex-col gap-2 sm:flex-row">
      <input
        name="link"
        required
        placeholder="https://drive.google.com/file/d/…/view"
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        disabled={enviando}
        className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {enviando ? "Criando…" : "Processar vídeo"}
      </button>
      {estado.erro && <p className="text-sm text-red-600 sm:basis-full">{estado.erro}</p>}
    </form>
  );
}
