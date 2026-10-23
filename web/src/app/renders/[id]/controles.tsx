"use client";

import { useState, useTransition } from "react";
import { gerarDeNovo } from "../actions";

/** Pula o player do vídeo final para um instante (segundos). */
export function PularPara({ s, children }: { s: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="tabular-nums text-emerald-700 hover:underline dark:text-emerald-400"
      onClick={() => {
        const v = document.querySelector<HTMLVideoElement>("video[data-final]");
        if (!v) return;
        v.currentTime = Math.max(0, s - 2);
        v.scrollIntoView({ behavior: "smooth", block: "center" });
        void v.play();
      }}
    >
      {children}
    </button>
  );
}

export function BotaoGerarDeNovo({ renderId, rotulo }: { renderId: string; rotulo: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        disabled={pendente}
        onClick={() => iniciar(async () => setErro((await gerarDeNovo(renderId)).erro ?? null))}
        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {rotulo}
      </button>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
