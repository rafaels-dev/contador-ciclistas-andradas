"use client";

import { useState, useTransition } from "react";
import type { Categoria } from "@/lib/db";
import { CATEGORIAS_CONTADAS } from "@/lib/revisao";
import { BOTAO } from "@/lib/ui";
import { gerarDeNovo } from "../actions";
import { EscolhaCategorias } from "../escolha-categorias";

type PropsPular = {
  s: number;
  children?: React.ReactNode;
  /** marca na timeline: classe de cor de fundo, posição e dica */
  marca?: string;
  left?: string;
  titulo?: string;
};

/** Pula o player do vídeo final para um instante (segundos). */
export function PularPara({ s, children, marca, left, titulo }: PropsPular) {
  function pular() {
    const v = document.querySelector<HTMLVideoElement>("video[data-final]");
    if (!v) return;
    v.currentTime = Math.max(0, s - 2);
    void v.play();
  }
  if (marca) {
    return (
      <button
        type="button"
        onClick={pular}
        title={titulo}
        aria-label={titulo}
        className={`absolute bottom-1.5 top-1.5 w-1 -translate-x-1/2 rounded-[1px] ${marca} hover:bottom-0.5 hover:top-0.5`}
        style={{ left }}
      />
    );
  }
  return (
    <button type="button" className="font-mono text-xs tabular-nums text-accent-text hover:underline" onClick={pular}>
      {children}
    </button>
  );
}

/** Gera de novo; `categorias` é a escolha gravada no render (null = todas) e pode ser mudada antes. */
export function BotaoGerarDeNovo({ renderId, rotulo, categorias }: { renderId: string; rotulo: string; categorias: Categoria[] | null }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [escolha, setEscolha] = useState<Categoria[]>(categorias ?? [...CATEGORIAS_CONTADAS]);
  const [editando, setEditando] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {editando && <EscolhaCategorias valor={escolha} aoMudar={setEscolha} />}
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pendente || !escolha.length} onClick={() => iniciar(async () => setErro((await gerarDeNovo(renderId, escolha)).erro ?? null))} className={BOTAO.secundario}>
          {rotulo}
        </button>
        {!editando && (
          <button type="button" onClick={() => setEditando(true)} className={BOTAO.fantasma}>
            Mudar categorias…
          </button>
        )}
      </div>
      {erro && <p className="text-sm text-danger">{erro}</p>}
    </div>
  );
}
