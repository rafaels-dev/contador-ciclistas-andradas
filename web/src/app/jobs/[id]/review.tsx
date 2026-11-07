"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Area, Candidate, Category, Line } from "@/lib/db";
import {
  computeTotals, COUNTED_CATEGORIES, countsOnLine, DIRECTIONS, isManual, NO_CONSULTATION, possibleDuplicates, proposal, readSuggestionError,
  type Direction, type Label, type Proposal,
} from "@/lib/review";
import { BUTTON, FIELD, LABEL_COLOR, PANEL_TITLE, sideLabels, timecode } from "@/lib/ui";
import { formatStored, parseMessage } from "@/i18n/message";
import { createFinalVideo } from "../../renders/actions";
import { choiceArgs, choiceReady, FinalVideoOptions, initialChoice } from "../../renders/final-options";
import { addManualCount, decide, removeManualCount, updateManualCount } from "./actions";
import { createClock, frameTimecode, useTime, type Clock } from "./clock";
import { Timeline } from "./timeline";

type Translator = ReturnType<typeof useTranslations>;

// keys 1–8 and 0, in the order of the buttons
const SHORTCUTS: [Label, string][] = [
  ["cyclists", "1"],
  ["pedestrians", "2"],
  ["cars", "3"],
  ["motorcycles", "4"],
  ["kick_scooters", "5"],
  ["mopeds", "6"],
  ["unicycles", "7"],
  ["other", "8"],
  ["discarded", "0"],
];
const BY_KEY: Record<string, Label> = { ...Object.fromEntries(SHORTCUTS.map(([c, k]) => [k, c])), x: "discarded" };
/** Shift + the same number adds a manual count of that category at the playhead (e.code: works on any layout) */
const MANUAL_BY_CODE = Object.fromEntries(
  SHORTCUTS.filter(([c]) => c !== "discarded").flatMap(([c, k]) => [[`Digit${k}`, c], [`Numpad${k}`, c]]),
) as Record<string, Category>;
const MANUAL_KEY = Object.fromEntries(SHORTCUTS.map(([c, k]) => [c, k])) as Record<Category, string>;

type Filter = "pending" | "reviewed" | "all" | "divergent" | "offLine" | "duplicates" | "manual" | Label;

const MAIN: Filter[] = ["pending", "reviewed", "all"];
const OTHER_FILTERS: Filter[] = ["manual", "duplicates", "offLine", "divergent", "cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "cars", "motorcycles", "other", "discarded"];
const NAMED_FILTERS = new Set<Filter>(["pending", "reviewed", "all", "divergent", "offLine", "duplicates", "manual"]);

/** What undo (U) puts back: decisions, or a manual count added/removed. */
type Undo =
  | { kind: "labels"; items: { id: number; before: Label | null }[] }
  | { kind: "added"; c: Candidate }
  | { kind: "removed"; c: Candidate };

const directionName = (tr: Translator, d: Direction | string | null) => d ?? tr("review.manual.noDirection");

/**
 * The frame on screen, cropped around the line where the object is crossing
 * (with margin), as a small JPEG: the manual count's thumbnail in the list.
 * null when the video is not showing (another tab) or cannot be read.
 */
function snapshot(v: HTMLVideoElement | null, line: Line | undefined): string | null {
  if (!v || !v.videoWidth || v.readyState < 2) return null;
  try {
    const [W, H] = [v.videoWidth, v.videoHeight];
    let [x0, y0, x1, y1] = [0, 0, W, H];
    if (line) {
      const m = 0.12 * Math.max(W, H);
      [x0, x1] = [Math.min(line.x1, line.x2) * W - m, Math.max(line.x1, line.x2) * W + m];
      [y0, y1] = [Math.min(line.y1, line.y2) * H - m, Math.max(line.y1, line.y2) * H + m];
      // the list shows ~2.4:1 — widen the short side so the crop is not stretched
      const [w, h] = [x1 - x0, y1 - y0];
      if (w < h * 1.6) [x0, x1] = [x0 - (h * 1.6 - w) / 2, x1 + (h * 1.6 - w) / 2];
      [x0, y0, x1, y1] = [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1)];
    }
    const scale = Math.min(1, 480 / (x1 - x0));
    const c = document.createElement("canvas");
    c.width = Math.round((x1 - x0) * scale);
    c.height = Math.round((y1 - y0) * scale);
    c.getContext("2d")!.drawImage(v, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** Category name for a label; "discarded" reads as the action ("Discard"). */
function labelName(tr: Translator, label: Label): string {
  return label === "discarded" ? tr("review.discard") : tr(`categories.singular.${label}`);
}

/** Error from a server action: a message key, a stored message or plain text. */
function actionError(tr: Translator, error: string): string {
  if (parseMessage(error)) return formatStored(tr, error);
  return tr.has(error) ? tr(error) : error;
}

type Props = {
  jobId: string;
  base: string;
  candidates: Candidate[];
  lines: Line[];
  duration: number;
  fps: number;
  /** size of the original video, to draw the lines over it */
  width: number;
  height: number;
  /** the original video, to navigate frame by frame */
  videoUrl: string;
  /** detection analysis area (null = whole frame), dashed over the video */
  area: Area | null;
  /** false while suggestions are running: read only */
  editable: boolean;
  /** "what each line counts" panel, shown in the inspector */
  linesPanel?: React.ReactNode;
};

/**
 * Human review laid out like an editor: candidate list (the "bin"), monitor
 * with the focused candidate's clip, inspector with the decision, and a
 * timeline of the whole video with one track per counting line.
 */
export function Review({ jobId, base, candidates: initial, lines, duration, fps, width, height, videoUrl, area, editable, linesPanel }: Props) {
  const t = useTranslations("review");
  const ts = useTranslations("shortcuts");
  const tr = useTranslations();
  const byId = useMemo(() => Object.fromEntries(lines.map((l) => [l.id, l])), [lines]);
  // the manual counts are added and removed here, without reloading the page
  const [candidates, setCandidates] = useState(initial);
  const [labels, setLabels] = useState<Record<number, Label | null>>(() => Object.fromEntries(candidates.map((c) => [c.id, c.label])));
  const [filter, setFilter] = useState<Filter>(editable ? "pending" : "all");
  const [lineFilter, setLineFilter] = useState("");
  const [focus, setFocus] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(0.9);
  const [history, setHistory] = useState<Undo[]>([]);
  const [manualLine, setManualLine] = useState<string | null>(lines[0]?.id ?? null);
  const [manualDirection, setManualDirection] = useState<Direction>("A→B");
  /** the last manual count, shown over the video for a few seconds (with undo) */
  const [added, setAdded] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const [sending, startRender] = useTransition();
  const [finalChoice, setFinalChoice] = useState(initialChoice);
  const [choosingFinal, setChoosingFinal] = useState(false);
  const [tab, setTab] = useState<Tab>("clip");
  const end = Math.max(duration, ...candidates.map((c) => c.time_s), 1);
  const [clock] = useState(() => createClock(end));
  const video = useRef<HTMLVideoElement>(null);
  const playOnOpen = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [table, setTable] = useState<number[] | null>(null);

  // real time of each frame in the file (DVRs have gaps in time; the worker counts frames)
  useEffect(() => {
    let alive = true;
    fetch(`/api/jobs/${jobId}/frames`)
      .then((r) => (r.ok ? r.json() : null))
      .then((ms: number[] | null) => {
        if (alive && ms?.length) setTable(ms.map((x) => x / 1000));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jobId]);

  /** where the candidate crosses, in the original video's time */
  const timeOf = useCallback((c: Candidate) => table?.[c.frame] ?? c.time_s, [table]);
  /** number of the frame shown at time t */
  const frameAt = useCallback(
    (time: number) => {
      if (!table) return Math.round(time * fps);
      let [a, b] = [0, table.length - 1];
      while (a < b) {
        const m = (a + b + 1) >> 1;
        if (table[m] <= time + 1e-3) a = m;
        else b = m - 1;
      }
      return a;
    },
    [table, fps],
  );
  const timeOfFrame = (q: number) => (table ? table[Math.min(table.length - 1, Math.max(0, q))] : Math.max(0, q) / fps);

  const candidateById = useMemo(() => Object.fromEntries(candidates.map((c) => [c.id, c])), [candidates]);
  // fixed number of each candidate in the video (time order), the same under any filter;
  // the manual counts have their own sequence (M1, M2…) so adding one does not renumber the others
  const number = useMemo(() => {
    const byTime = [...candidates].sort((a, b) => a.time_s - b.time_s || a.id - b.id);
    const auto = byTime.filter((c) => !isManual(c)).map((c, i) => [c.id, String(i + 1)]);
    const manual = byTime.filter(isManual).map((c, i) => [c.id, `M${i + 1}`]);
    return Object.fromEntries([...auto, ...manual]) as Record<number, string>;
  }, [candidates]);
  const proposals = useMemo(() => Object.fromEntries(candidates.map((c) => [c.id, proposal(c, byId)])), [candidates, byId]);
  const labelFor = (c: Candidate) => labels[c.id] ?? null;
  const divergent = (c: Candidate) => c.llm_status === "ok" && c.llm_suggestion !== c.yolo_class;
  const labelOf = (c: Candidate) => labelFor(c) ?? proposals[c.id].label;
  const duplicates = possibleDuplicates(candidates, (id) => labelOf(candidateById[id]));
  const passes = (c: Candidate, f: Filter) => {
    switch (f) {
      case "all": return true;
      case "pending": return !labelFor(c);
      case "reviewed": return !!labelFor(c);
      case "divergent": return divergent(c);
      case "offLine": return !!proposals[c.id].offLine;
      case "duplicates": return duplicates.has(c.id);
      case "manual": return isManual(c);
      default: return labelOf(c) === f;
    }
  };
  const onLine = candidates.filter((c) => !lineFilter || c.line_id === lineFilter);
  const visibleList = onLine.filter((c) => passes(c, filter));
  const visible = new Set(visibleList.map((c) => c.id));
  const totals = computeTotals(candidates.map((c) => ({ ...c, label: labelFor(c) })));
  const confident = visibleList.filter((c) => !labelFor(c) && proposals[c.id].label && ((c.llm_conf ?? 0) >= threshold || c.llm_model === NO_CONSULTATION));
  const filterName = (f: Filter) => (NAMED_FILTERS.has(f) ? t(`filters.${f}`) : tr(`categories.singular.${f}`));

  function apply(decisions: { id: number; label: Label | null }[], undoing = false) {
    if (!editable || !decisions.length) return;
    const before = decisions.map((d) => ({ id: d.id, before: labels[d.id] ?? null }));
    setLabels((r) => ({ ...r, ...Object.fromEntries(decisions.map((d) => [d.id, d.label])) }));
    if (!undoing) remember({ kind: "labels", items: before });
    setError(null);
    start(async () => {
      const r = await decide(jobId, decisions);
      if (r.error) {
        setError(actionError(tr, r.error));
        setLabels((x) => ({ ...x, ...Object.fromEntries(before.map((a) => [a.id, a.before])) }));
      }
    });
  }

  /** decides the focused candidate and jumps to the next pending one in the list */
  function decideFocused(c: Candidate, label: Label | null) {
    if (!label) return;
    apply([{ id: c.id, label }]);
    const i = visibleList.findIndex((x) => x.id === c.id);
    const next = [...visibleList.slice(i + 1), ...visibleList.slice(0, i)].find((x) => !labelFor(x));
    setFocus(next?.id ?? c.id);
  }

  function remember(u: Undo) {
    setHistory((h) => [...h.slice(-49), u]);
  }

  function undo() {
    const last = history.at(-1);
    if (!last) return;
    setHistory((u) => u.slice(0, -1));
    if (last.kind === "added") void removeManual(last.c, true);
    else if (last.kind === "removed") void addManual(last.c.label as Category, last.c, true);
    else {
      apply(last.items.map((a) => ({ id: a.id, label: a.before })), true);
      if (last.items.length === 1) setFocus(last.items[0].id);
    }
  }

  /**
   * Counts by hand, at the frame on screen, an object the detector missed:
   * the category of the key/button, on the line and direction chosen in the
   * bar under the video. Does not stop the video — whoever counts keeps
   * watching. `from` re-creates a removed count (undo).
   */
  async function addManual(label: Category, from?: Candidate, undoing = false) {
    if (!editable) return;
    const frame = from?.frame ?? frameAt(clock.time());
    const line_id = from ? from.line_id : manualLine;
    const direction = from ? (from.direction as Direction) : manualDirection;
    setError(null);
    const r = await addManualCount(jobId, {
      frame, line_id, direction, label,
      filmstrip: from?.filmstrip ?? null,
      snapshot: from ? null : snapshot(video.current, line_id ? byId[line_id] : undefined),
    });
    if (r.error || !r.candidate) return setError(actionError(tr, r.error ?? "job.errors.invalidManual"));
    const c = r.candidate;
    // in time order, like the detector's (the list and the timeline follow this array)
    setCandidates((x) => [...x, c].sort((m, n) => m.frame - n.frame || m.id - n.id));
    setLabels((x) => ({ ...x, [c.id]: c.label }));
    if (!undoing) remember({ kind: "added", c });
    setAdded(c);
  }

  async function removeManual(c: Candidate, undoing = false) {
    if (!editable) return;
    setError(null);
    const r = await removeManualCount(jobId, c.id);
    if (r.error) return setError(actionError(tr, r.error));
    // keeps the category as it is now (it may have been changed after it was added)
    const now = { ...c, label: labels[c.id] ?? c.label };
    // the focus goes to its neighbor in the list (otherwise it fell to the first item and the video jumped to the start)
    if (focused?.id === c.id) {
      const i = visibleList.findIndex((x) => x.id === c.id);
      setFocus((visibleList[i + 1] ?? visibleList[i - 1])?.id ?? null);
    }
    setCandidates((x) => x.filter((y) => y.id !== c.id));
    if (!undoing) remember({ kind: "removed", c: now });
    setAdded((a) => (a?.id === c.id ? null : a));
  }

  async function moveManual(c: Candidate, fields: { line_id: string | null; direction: Direction }) {
    const before = { line_id: c.line_id, direction: c.direction };
    setCandidates((x) => x.map((y) => (y.id === c.id ? { ...y, ...fields } : y)));
    const r = await updateManualCount(jobId, c.id, fields);
    if (r.error) {
      setError(actionError(tr, r.error));
      setCandidates((x) => x.map((y) => (y.id === c.id ? { ...y, ...before } : y)));
    }
  }

  function cycleDirection() {
    setManualDirection((d) => DIRECTIONS[(DIRECTIONS.indexOf(d) + 1) % DIRECTIONS.length]);
  }

  // the "+1" over the video goes away by itself
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(null), 6000);
    return () => clearTimeout(timer);
  }, [added]);

  /** goes to a candidate even if the current filter hides it */
  function goTo(id: number, filterIfHidden: Filter = "all") {
    if (!visible.has(id)) {
      setFilter(filterIfHidden);
      setLineFilter("");
    }
    setFocus(id);
  }

  // the focus must be in the visible list (filter change, a decided item went away)
  const focused = visibleList.find((c) => c.id === focus) ?? visibleList[0] ?? null;

  useEffect(() => {
    if (focused) document.getElementById(`cand-${focused.id}`)?.scrollIntoView({ block: "nearest" });
  }, [focused?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // picking a candidate takes the timeline playhead (and the video) to its crossing
  useEffect(() => {
    if (focused) clock.seek(timeOf(focused), "focus");
  }, [focused?.id, timeOf]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ←/→: one frame (±1) or, with Shift, one second (±1 s); pauses and shows the original video */
  function step(frames: number, seconds = 0) {
    video.current?.pause();
    setTab("video");
    const now = clock.time();
    const q = seconds ? frameAt(now + seconds) : frameAt(now) + frames;
    clock.seek(timeOfFrame(q), "user");
  }

  function changeSpeed(v: number) {
    setSpeed(v);
    if (video.current) video.current.playbackRate = v;
  }

  function consumePlay() {
    const play = playOnOpen.current;
    playOnOpen.current = false;
    return play;
  }

  function playPause() {
    const v = video.current;
    if (tab !== "video" || !v) {
      playOnOpen.current = true;
      setTab("video");
    } else if (v.paused) void v.play();
    else v.pause();
  }

  useEffect(() => {
    function key(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      const k = e.key.toLowerCase();
      const i = focused ? visibleList.findIndex((c) => c.id === focused.id) : -1;
      if (e.shiftKey && MANUAL_BY_CODE[e.code]) {
        if (!editable) return;
        void addManual(MANUAL_BY_CODE[e.code]);
      }
      else if (k === "d" && editable) cycleDirection();
      else if (k === "delete" && focused && isManual(focused) && editable) void removeManual(focused);
      else if (k === "arrowleft" || k === "arrowright") {
        const sign = k === "arrowleft" ? -1 : 1;
        if (e.shiftKey) step(0, sign);
        else step(sign);
      }
      else if (k === "p" || k === " ") {
        // Space plays/pauses, as in editors (it used to accept the proposal — too easy to press by accident)
        if (target.tagName === "BUTTON") return; // the focused button answers Space by itself
        playPause();
      }
      else if (k === "arrowdown" || k === "j") setFocus(visibleList[Math.min(visibleList.length - 1, i + 1)]?.id ?? null);
      else if (k === "arrowup" || k === "k") setFocus(visibleList[Math.max(0, i - 1)]?.id ?? null);
      else if (k === "u" || k === "backspace") undo();
      else if (!focused) return;
      else if (k === "enter") {
        if (target.tagName === "BUTTON") return; // Enter on a focused button is its click, not "accept"
        decideFocused(focused, proposals[focused.id].label);
      }
      else if (BY_KEY[k]) decideFocused(focused, BY_KEY[k]);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const count = (f: Filter) => onLine.filter((c) => passes(c, f)).length;

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-sm">
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label={t("filter")}>
          {MAIN.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`px-2.5 py-1 ${filter === f ? "bg-accent font-semibold text-accent-ink" : "bg-raised text-muted hover:bg-hover hover:text-fg"}`}
            >
              {filterName(f)} <span className="font-mono text-xs opacity-70">{count(f)}</span>
            </button>
          ))}
        </div>
        <select
          value={MAIN.includes(filter) ? "" : filter}
          onChange={(e) => setFilter((e.target.value || "pending") as Filter)}
          className={`${FIELD} py-1 ${MAIN.includes(filter) ? "" : "border-accent"}`}
          aria-label={t("moreFiltersLabel")}
        >
          <option value="">{t("moreFilters")}</option>
          {OTHER_FILTERS.map((f) => (
            <option key={f} value={f}>
              {filterName(f)} ({count(f)})
            </option>
          ))}
        </select>
        {lines.length > 1 && (
          <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} className={`${FIELD} py-1`} aria-label={t("lineFilter")}>
            <option value="">{t("allLines")}</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}

        {editable && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => apply(confident.map((c) => ({ id: c.id, label: proposals[c.id].label })))}
              disabled={!confident.length}
              className={BUTTON.secondary}
              title={t("acceptConfidentHint")}
            >
              {t("acceptConfident", { n: confident.length })}
            </button>
            <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className={`${FIELD} py-1`} aria-label={t("minConfidence")}>
              {[0.8, 0.9, 0.95].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
            <button type="button" onClick={undo} disabled={!history.length} className={BUTTON.ghost} title={t("undoHint")}>
              ↶ {t("undo")}
            </button>
          </>
        )}

        <span className="flex-1" />
        {duplicates.size > 0 && (
          <button type="button" onClick={() => setFilter("duplicates")} className="rounded-md px-2 py-1 text-warn hover:bg-warn/10">
            ⚠ {t("possibleDuplicates", { n: duplicates.size })}
          </button>
        )}
        {error && <span className="text-danger">{error}</span>}
        {editable && (
          <>
            <span className="font-mono text-xs text-muted">{totals.pending ? t("remaining", { n: totals.pending }) : t("complete")}</span>
            <span className="relative">
              <button
                type="button"
                disabled={totals.pending > 0 || sending}
                onClick={() => setChoosingFinal((v) => !v)}
                aria-expanded={choosingFinal}
                className={BUTTON.primary}
                title={totals.pending ? t("finalVideoLocked") : t("finalVideoHint")}
              >
                {t("finalVideoMenu")}
              </button>
              {choosingFinal && (
                <div className="absolute right-0 top-full z-20 mt-1 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-line bg-panel p-3 shadow-xl" data-testid="final-video-menu">
                  <FinalVideoOptions value={finalChoice} onChange={setFinalChoice} />
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setChoosingFinal(false)} className={BUTTON.ghost}>
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={!choiceReady(finalChoice) || sending}
                      onClick={() =>
                        startRender(async () => {
                          const r = await createFinalVideo([jobId], ...choiceArgs(finalChoice));
                          if (r.error) setError(actionError(tr, r.error));
                          else setChoosingFinal(false);
                        })
                      }
                      className={BUTTON.primary}
                    >
                      {sending ? t("sending") : t("finalVideo")}
                    </button>
                  </div>
                </div>
              )}
            </span>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[19rem_minmax(0,1fr)_19rem]">
        <CandidateList
          visible={visibleList}
          base={base}
          focused={focused?.id ?? null}
          number={number}
          labelOf={labelOf}
          labelFor={labelFor}
          conf={(c) => (c.llm_status === "ok" ? c.llm_conf : null)}
          byLine={byId}
          duplicates={duplicates}
          onFocus={setFocus}
          timeOf={timeOf}
          empty={filter === "pending" ? t("nothingPending") : t("noCandidates")}
        />

        <Monitor
          c={focused}
          base={base}
          number={focused ? number[focused.id] : ""}
          line={focused?.line_id ? byId[focused.line_id] : undefined}
          tab={tab}
          onTab={setTab}
          player={{ url: videoUrl, clock, video, fps, end, width, height, lines, area, consumePlay, speed, onSpeed: changeSpeed, onStep: step, onPlay: playPause, frameAt, timeOf }}
          manual={
            editable
              ? {
                  lines,
                  line: manualLine,
                  onLine: setManualLine,
                  direction: manualDirection,
                  onDirection: setManualDirection,
                  onAdd: (label) => void addManual(label),
                  added,
                  addedNumber: added ? number[added.id] : "",
                  onUndo: undo,
                  onShow: (id) => goTo(id, "manual"),
                }
              : null
          }
        />

        <aside className="flex flex-col border-line bg-panel lg:min-h-0 lg:overflow-y-auto lg:border-l">
          {focused ? (
            <Inspector
              c={focused}
              line={focused.line_id ? byId[focused.line_id] : undefined}
              prop={proposals[focused.id]}
              label={labelFor(focused)}
              editable={editable}
              number={number[focused.id]}
              duplicateOf={(duplicates.get(focused.id) ?? []).map((id) => ({ c: candidateById[id], number: number[id] }))}
              onDecide={(label) => decideFocused(focused, label)}
              onUndo={() => apply([{ id: focused.id, label: null }])}
              onGoTo={(id) => goTo(id, "duplicates")}
              lines={lines}
              timeOf={timeOf}
              onMove={(fields) => void moveManual(focused, fields)}
              onRemove={() => void removeManual(focused)}
            />
          ) : (
            <p className="p-4 text-sm text-muted">{t("noFocus")}</p>
          )}
          <TotalsPanel
            totals={totals}
            lines={lines}
            total={candidates.length}
            manual={candidates.filter((c) => isManual(c) && labelFor(c) && labelFor(c) !== "discarded").length}
          />
          {linesPanel}
          {editable && (
            <details className="border-t border-line px-4 py-3 text-xs text-muted">
              <summary className={`${PANEL_TITLE} cursor-pointer`}>{ts("title")}</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>{ts("prevNext")}</dd>
                <dt><kbd>Enter</kbd></dt><dd>{ts("accept")}</dd>
                {SHORTCUTS.map(([c, k]) => (
                  <span key={k} className="contents">
                    <dt><kbd>{k}</kbd></dt>
                    <dd>{c === "discarded" ? ts("discard") : tr(`categories.singular.${c}`)}</dd>
                  </span>
                ))}
                <dt><kbd>U</kbd></dt><dd>{ts("undo")}</dd>
                <dt><kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>8</kbd></dt><dd>{ts("addManual")}</dd>
                <dt><kbd>D</kbd></dt><dd>{ts("manualDirection")}</dd>
                <dt><kbd>Del</kbd></dt><dd>{ts("removeManual")}</dd>
                <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>{ts("frame")}</dd>
                <dt><kbd>{ts("space")}</kbd> <kbd>P</kbd></dt><dd>{ts("playPause")}</dd>
                <dt><kbd>+</kbd> <kbd>−</kbd></dt><dd>{ts("zoom")}</dd>
                <dt><kbd>\</kbd></dt><dd>{ts("wholeTimeline")}</dd>
              </dl>
            </details>
          )}
        </aside>
      </div>

      <Timeline
        candidates={candidates}
        lines={lines}
        duration={duration}
        fps={fps}
        focused={focused?.id ?? null}
        visible={visible}
        labelOf={labelOf}
        decided={(c) => !!labelFor(c)}
        number={number}
        onFocus={(id) => goTo(id)}
        clock={clock}
        timeOf={timeOf}
        onNavigate={() => setTab("video")}
      />
    </div>
  );
}

function Swatch({ label, hollow = false }: { label: Label | null; hollow?: boolean }) {
  if (!label) return <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-faint" />;
  const color = LABEL_COLOR[label];
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${hollow ? `border-2 ${color.border}` : color.bg}`} />;
}

type ListProps = {
  visible: Candidate[];
  base: string;
  focused: number | null;
  number: Record<number, string>;
  labelOf: (c: Candidate) => Label | null;
  labelFor: (c: Candidate) => Label | null;
  conf: (c: Candidate) => number | null;
  byLine: Record<string, Line>;
  duplicates: Map<number, number[]>;
  onFocus: (id: number) => void;
  empty: string;
  timeOf: (c: Candidate) => number;
};

function CandidateList({ visible, base, focused, number, labelOf, labelFor, conf, byLine, duplicates, onFocus, empty, timeOf }: ListProps) {
  const t = useTranslations("review");
  const tr = useTranslations();
  const format = useFormatter();
  return (
    <ul className="flex max-h-[60vh] flex-col overflow-y-auto border-line bg-panel lg:max-h-none lg:min-h-0 lg:border-r" aria-label={t("candidates")}>
      {visible.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">{empty}</li>}
      {visible.map((c) => {
        const r = labelFor(c);
        const label = labelOf(c);
        const active = focused === c.id;
        const p = conf(c);
        const line = c.line_id ? byLine[c.line_id] : undefined;
        return (
          <li
            key={c.id}
            id={`cand-${c.id}`}
            data-testid="candidate"
            data-label={r ?? ""}
            onClick={() => onFocus(c.id)}
            className={`flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-2.5 py-1.5 ${
              active ? "bg-accent/15 shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-hover"
            }`}
          >
            {c.filmstrip ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${base}/${c.filmstrip}`} alt="" loading="lazy" className={`h-10 w-24 shrink-0 rounded-sm bg-viewer object-cover ${r && !active ? "opacity-60" : ""}`} />
            ) : (
              <span className="flex h-10 w-24 shrink-0 items-center justify-center rounded-sm bg-viewer text-[0.65rem] text-white/50">{t("manual.badge")}</span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm">
                <span
                  className={`rounded px-1 font-mono text-[0.7rem] font-semibold tabular-nums ${duplicates.has(c.id) ? "bg-warn text-white" : "bg-raised text-muted"}`}
                  data-testid="number"
                >
                  #{number[c.id]}
                </span>
                <Swatch label={label} hollow={!r} />
                <span className={`truncate ${r ? "text-muted" : "font-medium"}`}>
                  {label ? labelName(tr, label) : c.llm_status === "failed" ? t("noSuggestion") : t("waiting")}
                </span>
                {!r && c.llm_status === "failed" && (
                  <span className="shrink-0 whitespace-nowrap rounded bg-danger/15 px-1 font-mono text-[0.65rem] text-danger" title={t("aiFailedHint")}>
                    {t("aiFailed")}
                  </span>
                )}
                {!r && p !== null && <span className="font-mono text-[0.7rem] text-faint">{format.number(p, { style: "percent", maximumFractionDigits: 0 })}</span>}
                {isManual(c) && (
                  <span className="shrink-0 rounded bg-info/15 px-1 text-[0.65rem] font-medium text-info" title={t("manual.badgeHint")} data-testid="manual-badge">
                    {t("manual.badge")}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[0.7rem] text-faint">
                <span>{timecode(timeOf(c))}</span>
                {line && (
                  <span className="truncate">
                    {line.name} {c.direction}
                  </span>
                )}
              </span>
            </span>
            {r && (
              <span className={`shrink-0 text-xs ${r === "discarded" ? "text-faint" : "text-ok"}`} title={t("reviewed")}>
                ✓
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Tab = "video" | "clip" | "frame";

type Player = {
  url: string;
  clock: Clock;
  video: React.RefObject<HTMLVideoElement | null>;
  fps: number;
  end: number;
  width: number;
  height: number;
  lines: Line[];
  area: Area | null;
  /** "P" pressed with another tab open: true once, to play as soon as the video loads */
  consumePlay: () => boolean;
  speed: number;
  onSpeed: (v: number) => void;
  onStep: (frames: number, seconds?: number) => void;
  onPlay: () => void;
  frameAt: (t: number) => number;
  timeOf: (c: Candidate) => number;
};

type Manual = {
  lines: Line[];
  line: string | null;
  onLine: (id: string | null) => void;
  direction: Direction;
  onDirection: (d: Direction) => void;
  onAdd: (label: Category) => void;
  /** the last count added, for the "+1" over the video */
  added: Candidate | null;
  addedNumber: string;
  onUndo: () => void;
  onShow: (id: number) => void;
};

type MonitorProps = {
  c: Candidate | null;
  base: string;
  number: string;
  line: Line | undefined;
  tab: Tab;
  onTab: (a: Tab) => void;
  player: Player;
  /** manual counting (null = read only) */
  manual: Manual | null;
};

/**
 * The editor's monitor: the original video at the timeline playhead
 * (frame-by-frame navigation), the focused candidate's clip, or the
 * crossing frame.
 */
function Monitor({ c, base, number, line, tab, onTab, player, manual }: MonitorProps) {
  const t = useTranslations("review");
  const shown: Tab = tab === "video" ? "video" : tab === "frame" && c?.context ? "frame" : c?.clip ? "clip" : c?.context ? "frame" : "video";
  return (
    <section className="flex min-w-0 flex-col bg-viewer lg:min-h-0" aria-label={t("monitor")}>
      <div className="relative flex min-h-64 flex-1 items-center justify-center overflow-hidden">
        {shown === "video" ? (
          <OriginalVideo player={player} sides={!!manual} />
        ) : !c ? (
          <span className="text-sm text-white/50">{t("pickCandidate")}</span>
        ) : shown === "clip" ? (
          <video key={c.id} src={`${base}/${c.clip}`} autoPlay loop muted playsInline className="max-h-full max-w-full" />
        ) : c.context ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${base}/${c.context}`} alt={t("crossingFrameAlt", { n: number })} className="max-h-full max-w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${base}/${c.filmstrip}`} alt={t("candidateAlt", { n: number })} className="max-h-full max-w-full object-contain" />
        )}
        {c && shown !== "video" && (
          <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 font-mono text-xs text-white">
            #{number} · {timecode(player.timeOf(c), true)}
            {line && ` · ${line.name} ${c.direction ?? ""}`}
          </span>
        )}
        <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded border border-white/15 text-xs" role="group" aria-label={t("show")}>
          {(
            [
              ["video", true],
              ["clip", !!c?.clip],
              ["frame", !!c?.context],
            ] as const
          ).map(([k, ok]) => (
            <button
              key={k}
              type="button"
              disabled={!ok}
              onClick={() => onTab(k)}
              aria-pressed={shown === k}
              title={t(`tabs.${k}Hint`)}
              className={`px-2 py-0.5 ${shown === k ? "bg-accent font-semibold text-accent-ink" : "bg-black/60 text-white/80 hover:bg-black/80"} disabled:opacity-30`}
            >
              {t(`tabs.${k}`)}
            </button>
          ))}
        </div>
        {manual?.added && <AddedToast manual={manual} fps={player.fps} timeOf={player.timeOf} />}
      </div>
      {shown === "video" ? (
        <>
          <Transport player={player} />
          {manual && <ManualBar manual={manual} />}
        </>
      ) : (
        c?.filmstrip && (
          <div className="border-t border-white/10 bg-black/40 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${base}/${c.filmstrip}`} alt={t("filmstripAlt")} className="mx-auto h-20 max-w-full object-contain" />
          </div>
        )
      )}
    </section>
  );
}

/**
 * The original video, always at the timeline playhead's frame. Back-to-back
 * seeks (dragging the ruler) wait for the previous one to finish and keep
 * only the last; while playing, the video moves the playhead.
 */
function OriginalVideo({ player, sides }: { player: Player; sides: boolean }) {
  const t = useTranslations("review");
  const { url, clock, video, fps, width, height, lines, area, consumePlay, speed } = player;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const ar = width / height || 16 / 9;
      const w = Math.min(el.clientWidth, el.clientHeight * ar);
      setSize({ w, h: w / ar });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // the metadata may arrive before hydration (video already cached): onLoadedMetadata never fires
    if (v.readyState >= 1 && v.videoWidth) setLoading(false);
    let seeking = false;
    let pending: number | null = null;
    // a quarter frame ahead: landing exactly on the boundary sometimes shows the previous frame
    const go = (time: number) => {
      if (seeking) {
        pending = time;
        return;
      }
      seeking = true;
      v.currentTime = time + 0.25 / fps;
    };
    const seeked = () => {
      seeking = false;
      if (pending !== null) {
        const time = pending;
        pending = null;
        go(time);
      }
    };
    v.addEventListener("seeked", seeked);
    const stop = clock.listen((time, source) => {
      if (source !== "video") go(time);
    });
    // playing, each frame shown moves the playhead; paused, the playhead is in charge
    let frame = 0;
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (!v.paused) clock.seek(meta.mediaTime, "video");
      frame = v.requestVideoFrameCallback(onFrame);
    };
    frame = v.requestVideoFrameCallback(onFrame);
    return () => {
      stop();
      v.removeEventListener("seeked", seeked);
      v.cancelVideoFrameCallback(frame);
    };
  }, [clock, video, fps]);

  async function failed() {
    setLoading(false);
    let status = 0;
    try {
      status = (await fetch(url, { headers: { Range: "bytes=0-0" } })).status;
    } catch {}
    setError(status === 404 ? t("videoMissing") : t("videoUnsupported"));
  }

  return (
    <div ref={box} className="absolute inset-0 flex items-center justify-center">
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <video
          ref={video}
          src={url}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (!v.videoWidth) return void failed();
            setLoading(false);
            v.currentTime = clock.time() + 0.25 / fps;
            v.playbackRate = speed;
            if (consumePlay()) void v.play();
          }}
          onError={failed}
          className="h-full w-full"
          data-testid="original-video"
        />
        {/* the counting lines over the video */}
        <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {area && (
            <rect
              x={area.x * width}
              y={area.y * height}
              width={area.w * width}
              height={area.h * height}
              fill="none"
              stroke="white"
              strokeOpacity={0.5}
              strokeWidth={width / 800}
              strokeDasharray={`${width / 100} ${width / 150}`}
            />
          )}
          {lines.map((l) => (
            <g key={l.id}>
              <line x1={l.x1 * width} y1={l.y1 * height} x2={l.x2 * width} y2={l.y2 * height} stroke="var(--accent)" strokeWidth={width / 400} strokeLinecap="round" opacity={0.85} />
              <text x={l.x1 * width} y={l.y1 * height - width / 160} fill="var(--accent)" fontSize={width / 70} fontWeight={600} stroke="black" strokeWidth={width / 1200} paintOrder="stroke">
                {l.name}
              </text>
              {/* the sides, so whoever counts by hand knows which direction is A→B */}
              {sides &&
                (() => {
                  const r = sideLabels(l, width, height);
                  const font = Math.max(width, height) * 0.016;
                  return (["a", "b"] as const).map((k) => (
                    <text key={k} x={r[k].x} y={r[k].y} fill="var(--accent)" fontSize={font} fontWeight="bold" textAnchor="middle" dominantBaseline="middle" stroke="black" strokeWidth={font * 0.12} paintOrder="stroke" opacity={0.9}>
                      {k.toUpperCase()}
                    </text>
                  ));
                })()}
            </g>
          ))}
        </svg>
      </div>
      {loading && !error && <span className="absolute text-sm text-white/60">{t("openingVideo")}</span>}
      {error && (
        <p className="absolute inset-x-6 rounded-md bg-black/80 p-4 text-center text-sm text-white" data-testid="video-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Counting by hand while watching: pick the line and the direction once, then
 * press the category (button or Shift+number) each time something the
 * detector missed passes. The count goes at the frame on screen.
 */
function ManualBar({ manual }: { manual: Manual }) {
  const t = useTranslations("review.manual");
  const tr = useTranslations();
  const { lines, line, onLine, direction, onDirection, onAdd } = manual;
  const current = lines.find((l) => l.id === line);
  const shown = COUNTED_CATEGORIES.filter((c) => countsOnLine(current, c));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white" role="group" aria-label={t("title")} data-testid="manual-bar">
      <span className="font-semibold text-white/90" title={t("hint")}>
        {t("title")}
      </span>
      {lines.length > 1 && (
        <select value={line ?? ""} onChange={(e) => onLine(e.target.value || null)} className="rounded border border-white/15 bg-black/60 px-1 py-0.5 text-white" aria-label={t("line")}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {lines.length > 0 && (
        <span className="flex overflow-hidden rounded border border-white/15" role="group" aria-label={t("direction")} title={t("directionHint")}>
          {DIRECTIONS.map((d) => (
            <button
              key={d ?? "-"}
              type="button"
              onClick={() => onDirection(d)}
              aria-pressed={direction === d}
              className={`px-1.5 py-0.5 font-mono ${direction === d ? "bg-white font-semibold text-black" : "bg-black/60 text-white/80 hover:bg-white/10"}`}
            >
              {directionName(tr, d)}
            </button>
          ))}
        </span>
      )}
      <span className="mx-0.5 h-4 w-px bg-white/15" />
      {shown.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onAdd(c)}
          className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 hover:border-white/40 hover:bg-white/15"
          title={t("addHint", { category: tr(`categories.singular.${c}`), key: MANUAL_KEY[c] })}
          data-testid={`manual-add-${c}`}
        >
          <Swatch label={c} />
          <span>+ {tr(`categories.singular.${c}`)}</span>
          <kbd className="border-white/20 bg-transparent px-1 text-[0.6rem] text-white/60">⇧{MANUAL_KEY[c]}</kbd>
        </button>
      ))}
    </div>
  );
}

/** "+1 Cyclist" over the video right after a manual count, with undo. */
function AddedToast({ manual, fps, timeOf }: { manual: Manual; fps: number; timeOf: (c: Candidate) => number }) {
  const t = useTranslations("review.manual");
  const tr = useTranslations();
  const c = manual.added!;
  const line = manual.lines.find((l) => l.id === c.line_id);
  return (
    <div
      key={c.id}
      className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md bg-black/80 px-3 py-1.5 text-sm text-white shadow-lg"
      role="status"
      data-testid="manual-toast"
    >
      <Swatch label={c.label} />
      <span className="font-semibold">+1 {tr(`categories.singular.${c.label as Category}`)}</span>
      <span className="font-mono text-xs text-white/60">
        #{manual.addedNumber} · {frameTimecode(timeOf(c), fps)}
        {line && ` · ${line.name} ${directionName(tr, c.direction)}`}
      </span>
      <button type="button" onClick={() => manual.onShow(c.id)} className="rounded px-1.5 text-xs text-white/80 underline hover:text-white">
        {t("show")}
      </button>
      <button type="button" onClick={manual.onUndo} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">
        {t("undo")} <kbd className="border-white/20 bg-transparent px-1 text-[0.6rem] text-white/60">U</kbd>
      </button>
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

/** Original video controls: frame by frame, seconds, play/pause and speed. */
function Transport({ player }: { player: Player }) {
  const t = useTranslations("review.transport");
  const format = useFormatter();
  const { clock, video, fps, end, onStep, onPlay, speed, onSpeed, frameAt } = player;
  const time = useTime(clock);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const update = () => setPlaying(!v.paused);
    v.addEventListener("play", update);
    v.addEventListener("pause", update);
    update();
    return () => {
      v.removeEventListener("play", update);
      v.removeEventListener("pause", update);
    };
  }, [video]);

  const button = "rounded px-2 py-1 font-mono text-white/80 hover:bg-white/10 hover:text-white";
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 bg-black/40 px-3 py-1.5 text-xs" role="group" aria-label={t("controls")}>
      <button type="button" onClick={() => onStep(0, -1)} className={button} title={t("back1sHint")}>
        {t("back1s")}
      </button>
      <button type="button" onClick={() => onStep(-1)} className={button} title={t("prevFrameHint")}>
        ◀︎ {t("frame")}
      </button>
      <button type="button" onClick={onPlay} className="mx-1 rounded bg-accent px-3 py-1 font-semibold text-accent-ink hover:bg-accent-hover" title={t("playPauseHint")}>
        {playing ? `❚❚ ${t("pause")}` : `▶︎ ${t("play")}`}
      </button>
      <button type="button" onClick={() => onStep(1)} className={button} title={t("nextFrameHint")}>
        {t("frame")} ▶︎
      </button>
      <button type="button" onClick={() => onStep(0, 1)} className={button} title={t("forward1sHint")}>
        {t("forward1s")}
      </button>
      <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} className="ml-2 rounded border border-white/15 bg-black/60 px-1 py-0.5 text-white" aria-label={t("speed")}>
        {SPEEDS.map((v) => (
          <option key={v} value={v}>
            {format.number(v)}×
          </option>
        ))}
      </select>
      <span className="ml-2 font-mono tabular-nums text-white">
        {frameTimecode(time, fps)} <span className="text-white/50">/ {timecode(end, true)} · {t("frameNumber", { n: frameAt(time) })}</span>
      </span>
    </div>
  );
}

type InspectorProps = {
  c: Candidate;
  line: Line | undefined;
  prop: Proposal;
  label: Label | null;
  editable: boolean;
  number: string;
  /** candidates that may be the same object (same line, direction and class, almost together) */
  duplicateOf: { c: Candidate; number: string }[];
  onDecide: (c: Label) => void;
  onUndo: () => void;
  onGoTo: (id: number) => void;
  lines: Line[];
  timeOf: (c: Candidate) => number;
  /** manual count: another line/direction */
  onMove: (fields: { line_id: string | null; direction: Direction }) => void;
  onRemove: () => void;
};

/** "{category} is not counted on {line} — proposal: discard." */
function OffLineNote({ category, line }: { category: Category; line: Line | undefined }) {
  const t = useTranslations("review");
  const tr = useTranslations();
  return <p className="text-xs text-warn">{t("notCountedOn", { category: tr(`categories.singular.${category}`), line: line?.name ?? t("thisLine") })}</p>;
}

/**
 * The AI did not answer for this candidate: shows the detector's proposal
 * (for Enter) and the full error — what OpenRouter/the provider returned —
 * for whoever is diagnosing.
 */
function SuggestionError({ c, prop, line }: { c: Candidate; prop: Proposal; line: Line | undefined }) {
  const t = useTranslations("review");
  const tr = useTranslations();
  const format = useFormatter();
  const error = readSuggestionError(c);
  const label = prop.offLine ?? prop.label;
  return (
    <>
      <p className="font-medium text-danger">{t("aiCouldNot")}</p>
      {label ? (
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Swatch label={label} />
          {tr(`categories.singular.${label}`)}
          <span className="ml-auto text-xs font-normal text-muted">{t("byDetector")}</span>
        </p>
      ) : (
        <p className="text-sm text-muted">{t("noProposal")}</p>
      )}
      {prop.offLine && <OffLineNote category={prop.offLine} line={line} />}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">{t("errorDetails")}</summary>
        <p className="mt-1 break-words font-mono" data-testid="suggestion-error">
          {error?.message ?? (c.llm_reason ? formatStored(tr, c.llm_reason) : t("noRecord"))}
          {error?.status != null && ` (HTTP ${error.status})`}
          {error?.attempts ? ` · ${t("attempts", { n: error.attempts })}` : ""}
          {error?.at && ` · ${format.dateTime(new Date(error.at), { dateStyle: "short", timeStyle: "medium" })}`}
        </p>
        {error?.detail && <p className="mt-1 break-words font-mono">{error.detail}</p>}
      </details>
    </>
  );
}

/** A count added by hand: when, on which line and direction (editable), and remove. */
function ManualInfo({ c, lines, editable, timeOf, onMove, onRemove }: Pick<InspectorProps, "c" | "lines" | "editable" | "timeOf" | "onMove" | "onRemove">) {
  const t = useTranslations("review.manual");
  const tr = useTranslations();
  return (
    <div className="flex flex-col gap-2" data-testid="manual-info">
      <h2 className={PANEL_TITLE}>{t("inspectorTitle")}</h2>
      <p className="text-sm text-muted">{t("addedAt", { time: timecode(timeOf(c), true), frame: c.frame })}</p>
      {editable && lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {lines.length > 1 && (
            <select value={c.line_id ?? ""} onChange={(e) => onMove({ line_id: e.target.value, direction: c.direction as Direction })} className={`${FIELD} py-1`} aria-label={t("line")}>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <span className="flex overflow-hidden rounded-md border border-line" role="group" aria-label={t("direction")}>
            {DIRECTIONS.map((d) => (
              <button
                key={d ?? "-"}
                type="button"
                onClick={() => onMove({ line_id: c.line_id, direction: d })}
                aria-pressed={c.direction === d}
                className={`px-2 py-1 font-mono text-xs ${c.direction === d ? "bg-accent font-semibold text-accent-ink" : "bg-raised text-muted hover:bg-hover"}`}
              >
                {directionName(tr, d)}
              </button>
            ))}
          </span>
        </div>
      )}
      {editable && (
        <button type="button" onClick={onRemove} className={`${BUTTON.danger} self-start`} data-testid="manual-remove">
          {t("remove")} <kbd className="text-[0.6rem]">Del</kbd>
        </button>
      )}
    </div>
  );
}

function Inspector({ c, line, prop, label, editable, number, duplicateOf, onDecide, onUndo, onGoTo, lines, timeOf, onMove, onRemove }: InspectorProps) {
  const t = useTranslations("review");
  const tr = useTranslations();
  const format = useFormatter();
  const manual = isManual(c);
  const corrected = label && label !== prop.label;
  const conf = c.llm_conf ?? 0;
  const cat = (x: Category) => tr(`categories.singular.${x}`);
  return (
    <div className="flex flex-col gap-4 px-4 py-3" data-testid="inspector">
      {manual ? (
        <ManualInfo c={c} lines={lines} editable={editable} timeOf={timeOf} onMove={onMove} onRemove={onRemove} />
      ) : (
      <div className="flex flex-col gap-2">
        <h2 className={PANEL_TITLE}>{t("modelSuggestion")}</h2>
        {c.llm_status === "ok" && prop.label ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold">
              <Swatch label={prop.offLine ?? prop.label} />
              {tr(`categories.singular.${prop.offLine ?? prop.label}`)}
              <span className="ml-auto font-mono text-sm font-normal text-muted">{format.number(conf, { style: "percent", maximumFractionDigits: 0 })}</span>
            </p>
            <span className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className={`block h-full ${conf >= 0.9 ? "bg-ok" : conf >= 0.7 ? "bg-accent" : "bg-warn"}`} style={{ width: `${conf * 100}%` }} />
            </span>
            {prop.offLine && <OffLineNote category={prop.offLine} line={line} />}
          </>
        ) : c.llm_status === "failed" ? (
          <SuggestionError c={c} prop={prop} line={line} />
        ) : (
          <p className="text-muted">{t("waitingSuggestion")}</p>
        )}
        {/* the model's reason is already in the language the job ran in; NO_CONSULTATION reasons are stored messages */}
        {c.llm_status === "ok" && c.llm_reason && <p className="text-sm text-muted">{formatStored(tr, c.llm_reason)}</p>}
        <p className="text-xs text-faint">
          {t("detector", { name: c.yolo_class ? (c.alternative ? t("either", { a: cat(c.yolo_class), b: cat(c.alternative) }) : cat(c.yolo_class)) : "?" })}
          {c.origin && c.origin !== "track" && ` · ${c.origin.replaceAll("_", " ")}`}
        </p>
      </div>
      )}

      {duplicateOf.length > 0 && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" data-testid="duplicate">
          ⚠ {t("duplicateBefore")}{" "}
          {duplicateOf.map((d, i) => (
            <span key={d.c.id}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onGoTo(d.c.id)} className="font-semibold underline">
                {t("duplicateItem", { n: d.number })}
              </button>{" "}
              ({timecode(d.c.time_s)})
            </span>
          ))}{" "}
          {t("duplicateAfter")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className={PANEL_TITLE}>{t("decision", { n: number })}</h2>
        {label ? (
          <p className="flex items-center gap-2 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold text-white ${manual || !corrected ? "bg-ok" : "bg-info"}`}>
              {manual ? t("manual.badge") : corrected ? t("corrected") : t("confirmed")}
            </span>
            <Swatch label={label} />
            {tr(`categories.singular.${label}`)}
            {editable && !manual && (
              <button type="button" onClick={onUndo} className={`${BUTTON.ghost} ml-auto text-xs`}>
                {t("undoOne")}
              </button>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted">{t("pending")}</p>
        )}
        {editable && (
          <>
            {prop.label && (
              <button type="button" onClick={() => onDecide(prop.label!)} className={`${BUTTON.primary} justify-between py-2`}>
                <span>{t("acceptAs", { label: prop.label === "discarded" ? t("discardLower") : tr(`categories.singular.${prop.label}`) })}</span>
                <kbd className="border-accent-ink/30 bg-transparent text-accent-ink">Enter</kbd>
              </button>
            )}
            <div className="grid grid-cols-2 gap-1">
              {SHORTCUTS.map(([l, k]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => onDecide(l)}
                  aria-pressed={label === l}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs ${
                    label === l ? "border-fg bg-fg text-app" : "border-line bg-raised hover:bg-hover"
                  } ${l === "discarded" ? "col-span-2" : ""}`}
                >
                  <Swatch label={l} />
                  <span className="flex-1 truncate">{l === "discarded" ? t("discardNotObject") : tr(`categories.singular.${l}`)}</span>
                  <span className="font-mono opacity-50">{k}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ORDER: Category[] = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "motorcycles", "cars", "other"];

/** Confirmed totals (human decisions only): category × line, with the directions on hover. */
function TotalsPanel({ totals, lines, total, manual }: { totals: ReturnType<typeof computeTotals>; lines: Line[]; total: number; manual: number }) {
  const t = useTranslations("review");
  const tr = useTranslations();
  const ids = lines.length ? lines.map((l) => l.id) : [""];
  const name = (id: string) => lines.find((l) => l.id === id)?.name ?? t("total");
  return (
    <section className="flex flex-col gap-2 border-t border-line px-4 py-3" data-testid="totals">
      <h2 className={PANEL_TITLE}>{t("confirmedCount")}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-faint">
            <th className="py-1 text-left font-normal" />
            {ids.map((id) => (
              <th key={id} className="max-w-20 truncate py-1 text-right font-normal" title={name(id)}>
                {name(id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ORDER.map((cat) => {
            const values = ids.map((id) => Object.values(totals.byLine[id]?.[cat] ?? {}).reduce((a, b) => a + b, 0));
            const any = values.some((n) => n > 0);
            return (
              <tr key={cat} className={any ? "" : "text-faint"}>
                <td className="py-0.5">
                  <span className="flex items-center gap-1.5">
                    <Swatch label={cat} />
                    {tr(`categories.singular.${cat}`)}
                  </span>
                </td>
                {ids.map((id, i) => {
                  const line = lines.find((l) => l.id === id);
                  const counts = !line?.categories?.length || line.categories.includes(cat);
                  const s = totals.byLine[id]?.[cat] ?? {};
                  return (
                    <td
                      key={id}
                      className={`py-0.5 text-right font-mono tabular-nums ${counts ? "" : "opacity-40"}`}
                      title={Object.keys(s).length ? Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(" · ") : undefined}
                    >
                      {values[i]}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="font-mono text-[0.7rem] text-faint">
        {t("summary", { reviewed: total - totals.pending, total, counted: totals.counted, discarded: totals.discarded })}
        {manual > 0 && ` · ${t("manual.summary", { n: manual })}`}
      </p>
    </section>
  );
}
