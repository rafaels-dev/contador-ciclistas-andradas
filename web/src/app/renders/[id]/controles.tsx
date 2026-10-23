"use client";

import { useState, useTransition } from "react";
import { BOTAO } from "@/lib/ui";
import { gerarDeNovo } from "../actions";

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

export function BotaoGerarDeNovo({ renderId, rotulo }: { renderId: string; rotulo: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <button disabled={pendente} onClick={() => iniciar(async () => setErro((await gerarDeNovo(renderId)).erro ?? null))} className={BOTAO.secundario}>
        {rotulo}
      </button>
      {erro && <p className="text-sm text-danger">{erro}</p>}
    </div>
  );
}
