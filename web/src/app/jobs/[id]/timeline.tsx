"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { Candidate, Line } from "@/lib/db";
import { isManual, type Label } from "@/lib/review";
import { LABEL_COLOR, timecode } from "@/lib/ui";
import { frameTimecode, useTime, type Clock } from "./clock";

const HEADER = 136; // column with the track names
const PX_MAX = 400; // maximum zoom, in px per second (≈ 27 px per frame at 15 fps)
const DEFAULT_HEIGHT = 170;
const HEIGHT_KEY = "tc:timelineHeight";

type Props = {
  candidates: Candidate[];
  lines: Line[];
  duration: number;
  fps: number;
  focused: number | null;
  visible: Set<number>;
  labelOf: (c: Candidate) => Label | null;
  decided: (c: Candidate) => boolean;
  number: Record<number, string>;
  onFocus: (id: number) => void;
  clock: Clock;
  /** where each candidate crosses, in the original video's time */
  timeOf: (c: Candidate) => number;
  /** the user moved the playhead via the ruler or the tracks: the monitor switches to the video */
  onNavigate: () => void;
};

type Track = { key: string; name: string; line: string | null; label?: Label | null };

/**
 * Timeline in the style of a video editor: ruler with the playhead (drag to
 * navigate), one track per counting line — or per line × category —, zoom
 * down to the frame (Ctrl+wheel, −/+, slider), drag the track background to
 * move the view, and adjustable height.
 */
export function Timeline({ candidates, lines, duration, fps, focused, visible, labelOf, decided, number, onFocus, clock, timeOf, onNavigate }: Props) {
  const t = useTranslations("timeline");
  const tr = useTranslations();
  const end = Math.max(duration, ...candidates.map(timeOf), 1);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(0); // usable width of the tracks, without the names column
  const [zoom, setZoom] = useState<number | null>(null); // px/s; null = whole video on screen
  const [scroll, setScroll] = useState(0);
  const saved = useSyncExternalStore(noSubscribe, readSavedHeight, () => DEFAULT_HEIGHT);
  const [manualHeight, setHeight] = useState<number | null>(null);
  const height = manualHeight ?? saved;
  const [byCategory, setByCategory] = useState(false);
  const anchor = useRef<{ t: number; x: number } | null>(null);

  const fit = view > 0 ? view / end : 1;
  const px = Math.min(Math.max(PX_MAX, fit), Math.max(fit, zoom ?? fit));
  const width = end * px;
  const state = useRef({ px, view });
  useLayoutEffect(() => {
    state.current = { px, view };
  });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView(Math.max(0, el.clientWidth - HEADER)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keeps the same instant under the mouse (or under the playhead) when the zoom changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current) {
      el.scrollLeft = anchor.current.t * px - anchor.current.x;
      anchor.current = null;
      setScroll(el.scrollLeft);
    }
  }, [px]);

  function changeZoom(next: number, at?: number, x?: number) {
    const el = scroller.current;
    if (!el) return;
    const { px: current, view: v } = state.current;
    if (at === undefined || x === undefined) {
      const xc = clock.time() * current - el.scrollLeft;
      if (xc >= 0 && xc <= v) [at, x] = [clock.time(), xc];
      else [at, x] = [(el.scrollLeft + v / 2) / current, v / 2];
    }
    anchor.current = { t: at, x };
    setZoom(Math.min(PX_MAX, Math.max(v / end, next)));
  }

  // Ctrl+wheel = zoom at the mouse point (needs a non-passive listener to stop the page zoom)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    function wheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      const x = Math.max(0, e.clientX - r.left - HEADER);
      const { px: current } = state.current;
      changeZoom(current * Math.exp(-e.deltaY * 0.0025), (el!.scrollLeft + x) / current, x);
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  // + / − / \ as in editors
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "+" || e.key === "=") changeZoom(state.current.px * 1.6);
      else if (e.key === "-" || e.key === "_") changeZoom(state.current.px / 1.6);
      else if (e.key === "\\") setZoom(null);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // the playhead left the view while the video plays or when a candidate is picked: the view follows
  useEffect(
    () =>
      clock.listen((time, source) => {
        const el = scroller.current;
        if (!el || source === "user") return;
        const { px: p, view: v } = state.current;
        const x = time * p - el.scrollLeft;
        if (x >= 8 && x <= v - 8) return;
        el.scrollLeft = source === "video" ? time * p - v * 0.1 : time * p - v / 2;
      }),
    [clock],
  );

  const labelName = useCallback(
    (label: Label | null) => (!label ? t("noSuggestion") : label === "discarded" ? tr("review.discard") : tr(`categories.singular.${label}`)),
    [t, tr],
  );

  const tracks: Track[] = useMemo(() => {
    const base = lines.length ? lines.map((l) => ({ id: l.id as string | null, name: l.name })) : [{ id: null, name: t("candidates") }];
    if (!byCategory) return base.map((l) => ({ key: l.id ?? "-", name: l.name, line: l.id }));
    return base.flatMap((l) => {
      const onLine = candidates.filter((c) => l.id === null || c.line_id === l.id);
      const labels = [...new Set(onLine.map((c) => labelOf(c)))].sort((a, b) => labelRank(a) - labelRank(b));
      return labels.map((label) => ({
        key: `${l.id ?? "-"}:${label ?? "?"}`,
        name: `${l.name} · ${labelName(label)}`,
        line: l.id,
        label,
      }));
    });
  }, [lines, candidates, byCategory, labelOf, labelName, t]);

  // ruler ticks: the largest that fits with ~80 px between labels; subdivisions of ≥ 8 px
  const steps = [1 / fps, 2 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((p) => p * px >= 80) ?? 3600;
  const minor = steps.filter((p) => p < step && Math.abs(step / p - Math.round(step / p)) < 1e-6).find((p) => p * px >= 8);
  const t0 = scroll / px;
  const t1 = (scroll + view) / px;
  const ticks: number[] = [];
  for (let k = Math.max(0, Math.floor(t0 / step)); k * step <= Math.min(end, t1 + step); k++) ticks.push(k * step);
  const tickLabel = (s: number) => (step < 1 ? frameTimecode(s, fps) : timecode(s, end >= 3600));

  const fitFactor = PX_MAX / Math.max(fit, 1e-9);
  const sliderPos = fitFactor > 1 ? Math.round((Math.log(px / fit) / Math.log(fitFactor)) * 1000) : 0;

  /** x position (in the tracks' content) → time */
  function timeAt(clientX: number) {
    const el = scroller.current!;
    return (clientX - el.getBoundingClientRect().left - HEADER + el.scrollLeft) / px;
  }

  function dragRuler(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    clock.seek(timeAt(e.clientX), "user");
    onNavigate();
    const move = (ev: PointerEvent) => clock.seek(timeAt(ev.clientX), "user");
    const release = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
  }

  /** dragging the background moves the view (like the editor's "hand"); a click without dragging takes the playhead there */
  function dragBackground(e: React.PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const el = scroller.current!;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    let moved = false;
    el.style.cursor = "grabbing";
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      el.scrollLeft = start.l - dx;
      el.scrollTop = start.t - dy;
    };
    const release = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      el.style.cursor = "";
      if (!moved && e.button === 0) {
        clock.seek(timeAt(ev.clientX), "user");
        onNavigate();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
  }

  function resize(e: React.PointerEvent) {
    e.preventDefault();
    const start = { y: e.clientY, h: height };
    let final = height;
    const move = (ev: PointerEvent) => {
      final = Math.round(Math.min(window.innerHeight * 0.7, Math.max(90, start.h - (ev.clientY - start.y))));
      setHeight(final);
    };
    const release = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      try {
        localStorage.setItem(HEIGHT_KEY, String(final));
      } catch {}
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
  }

  return (
    <section className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height }} aria-label={t("title")} data-testid="timeline">
      <div
        onPointerDown={resize}
        className="-mt-1 h-2 shrink-0 cursor-row-resize hover:bg-accent/30"
        title={t("resizeHint")}
        role="separator"
        aria-orientation="horizontal"
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 pb-1 text-xs">
        <CurrentTime clock={clock} fps={fps} end={end} />
        <span className="hidden text-faint md:inline">{t("help")}</span>
        <span className="flex-1" />
        <label className="flex cursor-pointer items-center gap-1.5 text-muted">
          <input type="checkbox" checked={byCategory} onChange={(e) => setByCategory(e.target.checked)} />
          {t("byCategory")}
        </label>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => changeZoom(px / 1.6)} className="rounded px-1.5 font-mono text-muted hover:bg-hover hover:text-fg" title={t("zoomOutHint")} aria-label={t("zoomOut")}>
            −
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={sliderPos}
            disabled={fitFactor <= 1}
            onChange={(e) => changeZoom(fit * Math.pow(fitFactor, Number(e.target.value) / 1000))}
            className="w-28 accent-[var(--accent)]"
            aria-label={t("zoom")}
          />
          <button type="button" onClick={() => changeZoom(px * 1.6)} className="rounded px-1.5 font-mono text-muted hover:bg-hover hover:text-fg" title={t("zoomInHint")} aria-label={t("zoomIn")}>
            +
          </button>
          <button type="button" onClick={() => setZoom(null)} className="rounded px-1.5 text-muted hover:bg-hover hover:text-fg" title={t("fitHint")}>
            {t("fit")}
          </button>
        </span>
      </div>

      <div ref={scroller} onScroll={(e) => setScroll(e.currentTarget.scrollLeft)} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        <div className="relative" style={{ width: HEADER + width, minHeight: "100%" }}>
          {/* ruler */}
          <div className="sticky top-0 z-20 flex h-6">
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-line bg-panel px-3 font-mono text-[0.7rem] text-faint" style={{ width: HEADER }}>
              {timecode(end, true)}
            </div>
            <div
              onPointerDown={dragRuler}
              className="relative cursor-ew-resize overflow-hidden border-b border-line bg-panel"
              style={{
                width,
                backgroundImage: minor ? "linear-gradient(to right, var(--line) 1px, transparent 1px)" : undefined,
                backgroundSize: minor ? `${minor * px}px 5px` : undefined,
                backgroundRepeat: "repeat-x",
                backgroundPosition: "left bottom",
              }}
              title={t("rulerHint")}
            >
              {ticks.map((s) => (
                <span key={s} className="pointer-events-none absolute top-0 flex h-full items-start border-l border-faint/60 pl-1 pt-0.5 font-mono text-[0.65rem] text-faint" style={{ left: s * px }}>
                  {tickLabel(s)}
                </span>
              ))}
              <Playhead clock={clock} px={px} handle />
            </div>
          </div>

          {tracks.map((track) => {
            const onTrack = candidates
              .filter((c) => (track.line === null || c.line_id === track.line) && (track.label === undefined || labelOf(c) === track.label))
              .sort((a, b) => timeOf(a) - timeOf(b));
            return (
              <div key={track.key} className="flex h-9">
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-r border-line bg-panel px-3 text-xs font-medium text-muted" style={{ width: HEADER }} title={track.name}>
                  {track.label !== undefined && <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${track.label ? LABEL_COLOR[track.label].bg : "border border-faint"}`} />}
                  <span className="truncate">{track.name}</span>
                </div>
                <div onPointerDown={dragBackground} className="relative cursor-grab overflow-hidden border-b border-line bg-raised/50" style={{ width }}>
                  {onTrack.map((c, i) => {
                    const x = timeOf(c) * px;
                    if (x < scroll - 200 || x > scroll + view + 200) return null;
                    const label = labelOf(c);
                    const color = label ? LABEL_COLOR[label] : null;
                    const ok = decided(c);
                    const active = c.id === focused;
                    const gap = i + 1 < onTrack.length ? (timeOf(onTrack[i + 1]) - timeOf(c)) * px : Infinity;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onFocus(c.id)}
                        title={`#${number[c.id]} · ${labelName(label)} · ${frameTimecode(timeOf(c), fps)}`}
                        aria-label={t("goTo", { n: number[c.id] })}
                        className={`group absolute bottom-1.5 top-1.5 flex items-center ${visible.has(c.id) ? "" : "opacity-25"}`}
                        style={{ left: x - 2 }}
                      >
                        {/* manual counts: a diamond, to tell them apart from the detector's */}
                        <span
                          className={`${isManual(c) ? "-ml-0.5 h-2.5 w-2.5 rotate-45" : "h-full w-1"} rounded-[1px] ${ok ? (color?.bg ?? "bg-faint") : `border ${color?.border ?? "border-faint"} bg-transparent`} ${
                            active ? "outline outline-2 outline-offset-1 outline-accent" : ""
                          } group-hover:scale-y-110`}
                        />
                        {gap >= 40 && <span className={`pl-1 font-mono text-[0.65rem] ${active ? "font-semibold text-fg" : "text-faint"}`}>#{number[c.id]}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* the empty area below the tracks drags too */}
          <div onPointerDown={dragBackground} className="cursor-grab" style={{ marginLeft: HEADER, height: 24 }} />

          <div className="pointer-events-none absolute bottom-0 top-6 z-[5]" style={{ left: HEADER }}>
            <Playhead clock={clock} px={px} />
          </div>
        </div>
      </div>
    </section>
  );
}

const noSubscribe = () => () => {};
function readSavedHeight(): number {
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY));
    return saved >= 90 ? saved : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

const LABEL_ORDER: (Label | null)[] = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "motorcycles", "cars", "other", "discarded", null];
const labelRank = (c: Label | null) => LABEL_ORDER.indexOf(c);

/** The playhead; only it re-renders while the video plays. */
function Playhead({ clock, px, handle = false }: { clock: Clock; px: number; handle?: boolean }) {
  const t = useTime(clock);
  return (
    <span className="pointer-events-none absolute top-0 h-full" style={{ left: t * px }} aria-hidden>
      <span className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-accent" />
      {handle && <span className="absolute -top-px h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-accent" />}
    </span>
  );
}

function CurrentTime({ clock, fps, end }: { clock: Clock; fps: number; end: number }) {
  const t = useTime(clock);
  return (
    <span className="font-mono tabular-nums">
      <span className="text-accent-text">{frameTimecode(t, fps)}</span>
      <span className="text-faint"> / {timecode(end, true)}</span>
    </span>
  );
}
