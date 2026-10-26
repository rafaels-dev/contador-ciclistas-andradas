"use client";

import { useState } from "react";
import { CAMPO, TITULO_PAINEL } from "@/lib/ui";
import { FormNovoJob } from "../form-novo-job";
import { SeletorLocal } from "../seletor-local";

type Props = { grupos: { id: string; nome: string }[]; grupoInicial: string; locais: boolean };

export function Importar({ grupos, grupoInicial, locais }: Props) {
  const [grupo, setGrupo] = useState(grupoInicial);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold">Importar vídeos</h1>
          <p className="max-w-2xl text-sm text-muted">
            Cada vídeo passa por: desenhar as linhas de contagem → detecção dos objetos que se movem → sugestão do modelo de
            visão para cada um → sua revisão → vídeo final.
          </p>
        </div>
        <span className="flex-1" />
        {grupos.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Colocar no grupo
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className={CAMPO} data-testid="grupo-destino">
              <option value="">Sem grupo</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className={`grid gap-4 ${locais ? "lg:grid-cols-2" : ""}`}>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
          <h2 className={TITULO_PAINEL}>Google Drive</h2>
          <p className="text-sm text-muted">Cole o link de um vídeo ou de uma pasta (compartilhada com “qualquer pessoa com o link”).</p>
          <FormNovoJob grupo={grupo} />
        </section>
        {locais && (
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
            <h2 className={TITULO_PAINEL}>Do computador</h2>
            <p className="text-sm text-muted">O vídeo é usado onde está, sem cópia — não mova nem renomeie o arquivo até terminar.</p>
            <SeletorLocal grupo={grupo} />
          </section>
        )}
      </div>
    </div>
  );
}
