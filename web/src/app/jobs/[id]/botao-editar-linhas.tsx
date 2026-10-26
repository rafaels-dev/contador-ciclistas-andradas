"use client";

import { BOTAO } from "@/lib/ui";
import { editarLinhas } from "./actions";

/** Pede confirmação: refazer os candidatos descarta sugestões e revisões. */
export function BotaoEditarLinhas({ jobId, rapido }: { jobId: string; rapido: boolean }) {
  return (
    <form
      action={editarLinhas.bind(null, jobId)}
      onSubmit={(e) => {
        const aviso = rapido
          ? "Editar as linhas refaz os candidatos (alguns minutos, sem repetir a detecção — a não ser que você mude a área de análise) e descarta as sugestões e revisões atuais. Continuar?"
          : "Este job não tem as trajetórias salvas: editar as linhas exige repetir a detecção inteira, e as sugestões e revisões atuais serão descartadas. Continuar?";
        if (!confirm(aviso)) e.preventDefault();
      }}
    >
      <button className={BOTAO.secundario}>
        Editar linhas
      </button>
    </form>
  );
}
