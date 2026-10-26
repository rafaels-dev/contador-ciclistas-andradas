"use client";

import { useSyncExternalStore } from "react";

/** De onde veio a mudança do cursor: o próprio vídeo tocando não pede busca de volta. */
export type Origem = "video" | "usuario" | "foco";

/**
 * O cursor de reprodução (playhead) da revisão. Fica fora do estado do React
 * porque muda a cada quadro enquanto o vídeo toca: só quem desenha o cursor
 * (timeline, timecode) se inscreve, e a lista de candidatos não redesenha.
 */
export type Relogio = {
  tempo(): number;
  buscar(t: number, origem: Origem): void;
  ouvir(fn: (t: number, origem: Origem) => void): () => void;
};

export function criarRelogio(duracao: number): Relogio {
  let tempo = 0;
  const ouvintes = new Set<(t: number, origem: Origem) => void>();
  return {
    tempo: () => tempo,
    buscar(t, origem) {
      const novo = Math.min(Math.max(0, t), duracao);
      if (novo === tempo && origem === "video") return;
      tempo = novo;
      for (const fn of ouvintes) fn(tempo, origem);
    },
    ouvir(fn) {
      ouvintes.add(fn);
      return () => void ouvintes.delete(fn);
    },
  };
}

export function useTempo(relogio: Relogio): number {
  return useSyncExternalStore(relogio.ouvir, relogio.tempo, relogio.tempo);
}

/** 3725.4 s a 15 fps → "1:02:05:06" (horas:minutos:segundos:quadro). */
export function timecodeQuadros(s: number, fps: number): string {
  const q = Math.round(s * fps);
  const f = Math.max(1, Math.round(fps));
  const t = Math.floor(q / f);
  const h = Math.floor(t / 3600);
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return `${h}:${m}:${ss}:${String(q % f).padStart(2, "0")}`;
}
