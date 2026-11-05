import type { Line } from "./db";
import type { Label } from "./review";

/**
 * Visual pieces repeated across screens (Tailwind classes written out in
 * full so Tailwind finds them in the code).
 */

export const BUTTON = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-40",
} as const;

export const FIELD =
  "rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none";

/** Panel header, in the style of editors (short title on the left, actions on the right). */
export const PANEL_TITLE = "font-display text-[0.8rem] font-semibold tracking-wide text-muted";

export const LABEL_COLOR: Record<Label, { bg: string; text: string; border: string }> = {
  cyclists: { bg: "bg-cat-cyclists", text: "text-cat-cyclists", border: "border-cat-cyclists" },
  pedestrians: { bg: "bg-cat-pedestrians", text: "text-cat-pedestrians", border: "border-cat-pedestrians" },
  cars: { bg: "bg-cat-cars", text: "text-cat-cars", border: "border-cat-cars" },
  motorcycles: { bg: "bg-cat-motorcycles", text: "text-cat-motorcycles", border: "border-cat-motorcycles" },
  kick_scooters: { bg: "bg-cat-kick-scooters", text: "text-cat-kick-scooters", border: "border-cat-kick-scooters" },
  mopeds: { bg: "bg-cat-mopeds", text: "text-cat-mopeds", border: "border-cat-mopeds" },
  unicycles: { bg: "bg-cat-unicycles", text: "text-cat-unicycles", border: "border-cat-unicycles" },
  other: { bg: "bg-cat-other", text: "text-cat-other", border: "border-cat-other" },
  discarded: { bg: "bg-cat-discarded", text: "text-cat-discarded", border: "border-cat-discarded" },
};

/** 471.3 → "7:51"; with hours past 1 h ("1:02:05"). */
export function timecode(s: number, hours = false): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h || hours ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Where to write "A" and "B" beside a line, in px of a W×H frame. Side A is to
 * the right of someone walking from (x1,y1) to (x2,y2) — same convention as
 * the worker (crossing A→B / B→A).
 */
export function sideLabels(l: Line, W: number, H: number) {
  const ax = l.x1 * W, ay = l.y1 * H, bx = l.x2 * W, by = l.y2 * H;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.max(W, H) * 0.03;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return {
    mx, my,
    a: { x: mx + (dy / len) * off, y: my - (dx / len) * off },
    b: { x: mx - (dy / len) * off, y: my + (dx / len) * off },
  };
}
