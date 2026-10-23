"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Grupo } from "@/lib/db";
import { BOTAO, CAMPO } from "@/lib/ui";
import { apagarGrupo, renomearGrupo } from "./_shell/actions";

export function CabecalhoGrupo({ grupo, titulo, videos }: { grupo: Grupo | null; titulo: string; videos: number }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(titulo);
  const [, iniciar] = useTransition();

  return (
    <header className="flex flex-wrap items-center gap-3">
      {editando && grupo ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setEditando(false);
            iniciar(() => renomearGrupo(grupo.id, nome));
          }}
        >
          <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditando(false)} className={`${CAMPO} text-lg font-semibold`} aria-label="Nome do grupo" />
          <button className={BOTAO.secundario}>Salvar</button>
        </form>
      ) : (
        <h1 className="font-display text-2xl font-semibold">{titulo}</h1>
      )}
      <span className="font-mono text-xs text-faint">
        {videos} {videos === 1 ? "vídeo" : "vídeos"}
      </span>
      <span className="flex-1" />
      {grupo && !editando && (
        <>
          <button type="button" onClick={() => (setNome(grupo.nome), setEditando(true))} className={BOTAO.fantasma}>
            Renomear
          </button>
          <button
            type="button"
            onClick={() => confirm(`Apagar o grupo “${grupo.nome}”? Os vídeos continuam na biblioteca, sem grupo.`) && iniciar(() => apagarGrupo(grupo.id))}
            className={BOTAO.perigo}
          >
            Apagar grupo
          </button>
        </>
      )}
      {grupo && (
        <Link href={`/importar?grupo=${grupo.id}`} className={BOTAO.secundario}>
          Importar para este grupo
        </Link>
      )}
    </header>
  );
}
