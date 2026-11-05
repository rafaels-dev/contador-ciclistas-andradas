"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// several parts of the screen may ask for refreshes at the same time (page
// and status bar): a single interval, at the shortest period requested
const requests = new Map<symbol, number>();
let timer: ReturnType<typeof setInterval> | null = null;
let period = 0;
let refresh: (() => void) | null = null;

function reschedule() {
  const shortest = requests.size ? Math.min(...requests.values()) : 0;
  if (shortest === period) return;
  if (timer) clearInterval(timer);
  timer = shortest ? setInterval(() => refresh?.(), shortest) : null;
  period = shortest;
}

/** Reloads the server data periodically while something is working. */
export function AutoRefresh({ ms = 1500 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const key = Symbol();
    refresh = () => router.refresh();
    requests.set(key, ms);
    reschedule();
    return () => {
      requests.delete(key);
      reschedule();
    };
  }, [router, ms]);
  return null;
}
