"use client";

import { editarLinhas } from "./actions";

/** Pede confirmação: refazer os candidatos descarta sugestões e revisões. */
export function BotaoEditarLinhas({ jobId, rapido }: { jobId: string; rapido: boolean }) {
  return (
    <form
      action={editarLinhas.bind(null, jobId)}
      onSubmit={(e) => {
        const aviso = rapido
          ? "Editar as linhas refaz os candidatos (alguns minutos, sem repetir a detecção) e descarta as sugestões e revisões atuais. Continuar?"
          : "Este job não tem as trajetórias salvas: editar as linhas exige repetir a detecção inteira, e as sugestões e revisões atuais serão descartadas. Continuar?";
        if (!confirm(aviso)) e.preventDefault();
      }}
    >
      <button className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
        Editar linhas
      </button>
    </form>
  );
}
