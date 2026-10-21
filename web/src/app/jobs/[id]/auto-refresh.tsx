"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega os dados do servidor periodicamente enquanto o job trabalha. */
export function AutoRefresh({ ms = 1500 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
