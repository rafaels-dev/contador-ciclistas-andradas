"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// várias partes da tela podem pedir atualização ao mesmo tempo (página e
// barra de status): um único intervalo, no menor período pedido
const pedidos = new Map<symbol, number>();
let timer: ReturnType<typeof setInterval> | null = null;
let periodo = 0;
let atualizar: (() => void) | null = null;

function reagendar() {
  const menor = pedidos.size ? Math.min(...pedidos.values()) : 0;
  if (menor === periodo) return;
  if (timer) clearInterval(timer);
  timer = menor ? setInterval(() => atualizar?.(), menor) : null;
  periodo = menor;
}

/** Recarrega os dados do servidor periodicamente enquanto algo trabalha. */
export function AutoRefresh({ ms = 1500 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const chave = Symbol();
    atualizar = () => router.refresh();
    pedidos.set(chave, ms);
    reagendar();
    return () => {
      pedidos.delete(chave);
      reagendar();
    };
  }, [router, ms]);
  return null;
}
