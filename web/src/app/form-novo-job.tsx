"use client";

import { useActionState } from "react";
import { BOTAO, CAMPO } from "@/lib/ui";
import { criarJobsDaPasta, novoJob, type EstadoNovoJob } from "./actions";

export function FormNovoJob({ grupo }: { grupo: string }) {
  const [estado, acao, enviando] = useActionState<EstadoNovoJob, FormData>(novoJob, {});

  return (
    <div className="flex flex-col gap-3">
      <form action={acao} className="flex flex-col gap-2">
        <input type="hidden" name="grupo" value={grupo} />
        <div className="flex gap-2">
          <input name="link" required placeholder="https://drive.google.com/…" aria-label="Link do Google Drive" className={`${CAMPO} min-w-0 flex-1`} />
          <button disabled={enviando} className={BOTAO.primario}>
            {enviando ? "Abrindo…" : "Abrir"}
          </button>
        </div>
        {estado.erro && <p className="text-sm text-danger">{estado.erro}</p>}
      </form>

      {estado.pasta && (
        <form key={estado.pasta.id} action={criarJobsDaPasta} className="flex flex-col gap-3">
          <input type="hidden" name="grupo" value={grupo} />
          <p className="text-sm font-medium">{estado.pasta.arquivos.length} vídeo(s) na pasta — marque quais processar:</p>
          <ul className="flex max-h-80 flex-col overflow-y-auto rounded-md border border-line bg-raised text-sm">
            {estado.pasta.arquivos.map((a) => (
              <li key={a.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-hover">
                  <input type="checkbox" name="arquivo" value={`${a.id}|${a.nome}`} className="accent-[var(--accent)]" />
                  <span className="truncate">{a.nome}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className={`${BOTAO.primario} self-start`}>Importar os marcados</button>
        </form>
      )}
    </div>
  );
}
