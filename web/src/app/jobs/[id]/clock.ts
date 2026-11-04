"use client";

import { useSyncExternalStore } from "react";

/** Where the playhead change came from: the video itself playing does not ask for a seek back. */
export type ClockSource = "video" | "user" | "focus";

/**
 * The review's playhead. It lives outside React state because it changes on
 * every frame while the video plays: only what draws the playhead (timeline,
 * timecode) subscribes, and the candidate list does not re-render.
 */
export type Clock = {
  time(): number;
  seek(t: number, source: ClockSource): void;
  listen(fn: (t: number, source: ClockSource) => void): () => void;
};

export function createClock(duration: number): Clock {
  let time = 0;
  const listeners = new Set<(t: number, source: ClockSource) => void>();
  return {
    time: () => time,
    seek(t, source) {
      const next = Math.min(Math.max(0, t), duration);
      if (next === time && source === "video") return;
      time = next;
      for (const fn of listeners) fn(time, source);
    },
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export function useTime(clock: Clock): number {
  return useSyncExternalStore(clock.listen, clock.time, clock.time);
}

/** 3725.4 s at 15 fps → "1:02:05:06" (hours:minutes:seconds:frame). */
export function frameTimecode(s: number, fps: number): string {
  // the seconds come from the time itself: counting frames at the rounded rate (15 instead of
  // the DVR's 14.87) drifted ~22 s by the 43rd minute, against the list's timecode()
  const f = Math.max(1, Math.round(fps));
  const t = Math.floor(Math.max(0, s) + 1e-6);
  const q = t * f + Math.min(f - 1, Math.floor((Math.max(0, s) - t) * fps + 1e-6));
  const h = Math.floor(t / 3600);
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return `${h}:${m}:${ss}:${String(q % f).padStart(2, "0")}`;
}
