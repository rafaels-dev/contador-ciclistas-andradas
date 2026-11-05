"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Area, Line } from "@/lib/db";
import { confirmLines } from "./actions";
import { BUTTON, FIELD, PANEL_TITLE, sideLabels } from "@/lib/ui";
import { CategoryChips } from "./line-categories";

type Props = {
  jobId: string;
  frameUrl: string;
  width: number;
  height: number;
  initialLines: Line[];
  initialArea: Area | null;
  cameras: { id: string; name: string; lines: Line[]; area: Area | null }[];
  initialCamera: string | null;
  /** ground points of the trajectories already detected (null before the 1st detection) */
  pointsUrl: string | null;
};

type Points = Partial<Record<"cyclists" | "pedestrians" | "cars" | "motorcycles" | "other", [number, number][]>>;

// name → lineEditor.points.<key>
const POINT_COLOR: Record<keyof Points, string> = {
  cyclists: "#22c55e",
  pedestrians: "#3b82f6",
  motorcycles: "#d946ef",
  cars: "#f97316",
  other: "#a8a29e",
};

const COLORS = ["#facc15", "#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#c084fc"];

/** Videos wider than this are downscaled for detection — that's where the analysis area makes a difference. */
const PROCESSED_WIDTH = 1920;

/**
 * Analysis area around the lines, with room for the object to be tracked
 * before and after crossing (and never smaller than ~1/4 of the frame).
 */
function areaAroundLines(lines: Line[], W: number, H: number): Area | null {
  if (!lines.length) return null;
  const xs = lines.flatMap((l) => [l.x1 * W, l.x2 * W]);
  const ys = lines.flatMap((l) => [l.y1 * H, l.y2 * H]);
  let [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = Math.max(0.6 * Math.max(x2 - x1, y2 - y1), 0.08 * W);
  [x1, x2, y1, y2] = [x1 - margin, x2 + margin, y1 - margin, y2 + margin];
  const minW = Math.min(W, Math.max(W / 2, 960));
  const minH = Math.min(H, Math.max(H / 2, 540));
  if (x2 - x1 < minW) [x1, x2] = [(x1 + x2 - minW) / 2, (x1 + x2 + minW) / 2];
  if (y2 - y1 < minH) [y1, y2] = [(y1 + y2 - minH) / 2, (y1 + y2 + minH) / 2];
  const inside = (a: number, b: number, max: number) => {
    const size = Math.min(b - a, max);
    const start = Math.min(Math.max(0, a), max - size);
    return [start, size];
  };
  const [ax, aw] = inside(x1, x2, W);
  const [ay, ah] = inside(y1, y2, H);
  return { x: ax / W, y: ay / H, w: aw / W, h: ah / H };
}

const rectangle = (r: { x0: number; y0: number; x1: number; y1: number }): Area => ({
  x: Math.min(r.x0, r.x1),
  y: Math.min(r.y0, r.y1),
  w: Math.abs(r.x1 - r.x0),
  h: Math.abs(r.y1 - r.y0),
});

const outside = (l: Line, a: Area) =>
  [[l.x1, l.y1], [l.x2, l.y2]].some(([x, y]) => x < a.x - 1e-3 || y < a.y - 1e-3 || x > a.x + a.w + 1e-3 || y > a.y + a.h + 1e-3);

export function LineEditor({ jobId, frameUrl, width: W, height: H, initialLines, initialArea, cameras, initialCamera, pointsUrl }: Props) {
  const t = useTranslations("lineEditor");
  const tRoot = useTranslations();
  const [points, setPoints] = useState<Points | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set(Object.keys(POINT_COLOR)));
  useEffect(() => {
    if (!pointsUrl) return;
    fetch(pointsUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPoints)
      .catch(() => setPoints(null));
  }, [pointsUrl]);
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [draft, setDraft] = useState<Line | null>(null);
  // area: on by default for videos larger than 1080p; follows the lines until the user draws one
  const [useArea, setUseArea] = useState(initialArea !== null || W > PROCESSED_WIDTH);
  const [manualArea, setManualArea] = useState<Area | null>(initialArea);
  const [mode, setMode] = useState<"line" | "area">("line");
  const [areaDraft, setAreaDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const area = useArea ? (manualArea ?? areaAroundLines(lines, W, H)) : null;
  const [cameraId, setCameraId] = useState(initialCamera ?? "");
  const [cameraName, setCameraName] = useState(cameras.find((c) => c.id === initialCamera)?.name ?? "");
  const [saveAsCamera, setSaveAsCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const svgRef = useRef<SVGSVGElement>(null);

  function point(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    const p = point(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (mode === "area") {
      setAreaDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    const n = lines.length + 1;
    let id = `l${n}`;
    while (lines.some((l) => l.id === id)) id += "b";
    setDraft({ id, name: t("defaultLineName", { n }), x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (areaDraft) {
      const p = point(e);
      setAreaDraft({ ...areaDraft, x1: p.x, y1: p.y });
      return;
    }
    if (!draft) return;
    const p = point(e);
    setDraft({ ...draft, x2: p.x, y2: p.y });
  }

  function onPointerUp() {
    if (areaDraft) {
      const a = rectangle(areaDraft);
      if (a.w * W > 40 && a.h * H > 40) {
        setManualArea(a);
        setMode("line");
      }
      setAreaDraft(null);
      return;
    }
    if (draft && Math.hypot((draft.x2 - draft.x1) * W, (draft.y2 - draft.y1) * H) > 20) {
      setLines([...lines, draft]);
    }
    setDraft(null);
  }

  function loadCamera(id: string) {
    setCameraId(id);
    const cam = cameras.find((c) => c.id === id);
    if (cam) {
      setLines(cam.lines);
      setCameraName(cam.name);
      if (cam.area) {
        setUseArea(true);
        setManualArea(cam.area);
      }
    }
  }

  function submit() {
    setError(null);
    startSending(async () => {
      const camera = saveAsCamera && cameraName.trim() ? { id: cameraId, name: cameraName } : null;
      const r = await confirmLines(jobId, lines, camera, area);
      if (r.error) setError(tRoot(r.error));
    });
  }

  const all = draft ? [...lines, draft] : lines;
  const shownArea = areaDraft ? rectangle(areaDraft) : area;
  const linesOutside = area ? lines.filter((l) => outside(l, area)) : [];
  const areaPx = area ? { w: Math.round(area.w * W), h: Math.round(area.h * H) } : null;

  return (
    <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-w-0 items-center justify-center bg-viewer p-4 lg:min-h-0" aria-label={t("frameLabel")}>
        <div className="relative max-h-full w-full select-none overflow-hidden" style={{ aspectRatio: `${W} / ${H}`, maxWidth: `calc((100dvh - 9rem) * ${W / H})` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frameUrl} alt={t("firstFrameAlt")} className="absolute inset-0 h-full w-full" draggable={false} />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className={`absolute inset-0 h-full w-full touch-none ${mode === "area" ? "cursor-cell" : "cursor-crosshair"}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            data-testid="drawing-surface"
          >
            {shownArea && (
              <g pointerEvents="none" data-testid="analysis-area">
                {/* what lies outside the area is not analyzed: dimmed */}
                <path
                  d={`M0 0H${W}V${H}H0Z M${shownArea.x * W} ${shownArea.y * H}v${shownArea.h * H}h${shownArea.w * W}v${-shownArea.h * H}Z`}
                  fill="black"
                  fillOpacity={0.55}
                  fillRule="evenodd"
                />
                <rect
                  x={shownArea.x * W}
                  y={shownArea.y * H}
                  width={shownArea.w * W}
                  height={shownArea.h * H}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={Math.max(W, H) * 0.0025}
                  strokeDasharray={`${Math.max(W, H) * 0.012} ${Math.max(W, H) * 0.008}`}
                />
                <text
                  x={shownArea.x * W + Math.max(W, H) * 0.006}
                  y={shownArea.y * H + Math.max(W, H) * 0.02}
                  fill="var(--accent)"
                  fontSize={Math.max(W, H) * 0.014}
                  fontWeight="bold"
                  stroke="black"
                  strokeWidth={Math.max(W, H) * 0.002}
                  paintOrder="stroke"
                >
                  {t("analysisArea")}
                </text>
              </g>
            )}
            {points &&
              (Object.keys(POINT_COLOR) as (keyof Points)[])
                .filter((k) => visible.has(k))
                .map((k) => (
                  <g key={k} fill={POINT_COLOR[k]} fillOpacity={0.55} pointerEvents="none">
                    {points[k]?.map(([x, y], i) => <circle key={i} cx={x * W} cy={y * H} r={Math.max(W, H) * 0.0018} />)}
                  </g>
                ))}
            {all.map((l, i) => {
              const color = COLORS[i % COLORS.length];
              const r = sideLabels(l, W, H);
              const font = Math.max(W, H) * 0.018;
              return (
                <g key={l.id} pointerEvents="none">
                  <line x1={l.x1 * W} y1={l.y1 * H} x2={l.x2 * W} y2={l.y2 * H} stroke="black" strokeWidth={font * 0.45} strokeOpacity={0.5} />
                  <line x1={l.x1 * W} y1={l.y1 * H} x2={l.x2 * W} y2={l.y2 * H} stroke={color} strokeWidth={font * 0.25} />
                  <circle cx={l.x1 * W} cy={l.y1 * H} r={font * 0.35} fill={color} />
                  <circle cx={l.x2 * W} cy={l.y2 * H} r={font * 0.35} fill={color} />
                  {l !== draft && (
                    <>
                      <text x={r.a.x} y={r.a.y} fill={color} fontSize={font} fontWeight="bold" textAnchor="middle" dominantBaseline="middle" stroke="black" strokeWidth={font * 0.12} paintOrder="stroke">A</text>
                      <text x={r.b.x} y={r.b.y} fill={color} fontSize={font} fontWeight="bold" textAnchor="middle" dominantBaseline="middle" stroke="black" strokeWidth={font * 0.12} paintOrder="stroke">B</text>
                      <text x={l.x1 * W} y={l.y1 * H - font} fill="white" fontSize={font * 0.8} textAnchor="middle" stroke="black" strokeWidth={font * 0.12} paintOrder="stroke">{l.name}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          {mode === "area" ? (
            <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-sm text-white">
              {t("dragArea")}
            </span>
          ) : (
            !lines.length &&
            !draft && (
              <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-sm text-white">
                {t("dragLine")}
              </span>
            )
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4 border-line bg-panel px-4 py-3 lg:min-h-0 lg:overflow-y-auto lg:border-l">
        <section className="flex flex-col gap-2">
          <h2 className={PANEL_TITLE}>{t("countingLines")}</h2>
          <p className="text-sm text-muted">
            {t.rich("linesIntro", { b: (chunks) => <strong className="text-fg">{chunks}</strong> })}
          </p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">{t("howToPlace")}</summary>
            <p className="mt-1">{t("howToPlaceText")}</p>
          </details>
        </section>

        {cameras.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("useCameraLines")}</span>
            <select value={cameraId} onChange={(e) => loadCamera(e.target.value)} className={FIELD}>
              <option value="">—</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {lines.length > 0 && (
          <ul className="flex flex-col gap-3">
            {lines.map((l, i) => (
              <li key={l.id} className="flex flex-col gap-2 rounded-md border border-line bg-raised p-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <input
                    value={l.name}
                    onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))}
                    className={`${FIELD} min-w-0 flex-1 py-1`}
                    aria-label={t("lineNameLabel", { n: i + 1 })}
                  />
                </div>
                <CategoryChips
                  value={l.categories}
                  label={t("lineCategoriesLabel", { n: i + 1 })}
                  onChange={(v) => setLines(lines.map((x) => (x.id === l.id ? { ...x, categories: v } : x)))}
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setLines(lines.map((x) => (x.id === l.id ? { ...x, x1: x.x2, y1: x.y2, x2: x.x1, y2: x.y1 } : x)))}
                    className={BUTTON.ghost}
                    title={t("swapSidesHint")}
                  >
                    {t("swapSides")}
                  </button>
                  <button type="button" onClick={() => setLines(lines.filter((x) => x.id !== l.id))} className={BUTTON.danger}>
                    {t("remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className="flex flex-col gap-2 text-sm" data-testid="area-panel">
          <h2 className={PANEL_TITLE}>{t("analysisArea")}</h2>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={useArea}
              onChange={(e) => {
                setUseArea(e.target.checked);
                if (!e.target.checked) setMode("line");
              }}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>{t("useArea")}</span>
          </label>
          <p className="text-xs text-muted">{t("areaIntro")}</p>
          {useArea && (
            <>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setMode(mode === "area" ? "line" : "area")}
                  aria-pressed={mode === "area"}
                  className={mode === "area" ? BUTTON.primary : BUTTON.secondary}
                >
                  {mode === "area" ? t("drawingArea") : t("drawArea")}
                </button>
                <button type="button" onClick={() => setManualArea(null)} disabled={!manualArea} className={BUTTON.ghost} title={t("fitToLinesHint")}>
                  {t("fitToLines")}
                </button>
              </div>
              {areaPx ? (
                <p className="font-mono text-xs text-faint">
                  {t("areaPixels", { w: areaPx.w, h: areaPx.h })}
                  {areaPx.w > PROCESSED_WIDTH ? t("areaReduced", { max: PROCESSED_WIDTH }) : t("areaFullResolution")}
                  {!manualArea && t("areaAutomatic")}
                </p>
              ) : (
                <p className="text-xs text-muted">{t("areaNoLines")}</p>
              )}
              {areaPx && areaPx.w > PROCESSED_WIDTH && <p className="text-xs text-warn">{t("areaTooWide", { max: PROCESSED_WIDTH })}</p>}
              {linesOutside.map((l) => (
                <p key={l.id} className="text-xs text-warn" data-testid="line-outside-area">
                  {t("lineOutsideArea", { name: l.name })}
                </p>
              ))}
            </>
          )}
        </section>

        {points && (
          <section className="flex flex-col gap-1.5 text-sm">
            <h2 className={PANEL_TITLE}>{t("wherePassed")}</h2>
            {(Object.keys(POINT_COLOR) as (keyof Points)[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visible.has(k)}
                  className="accent-[var(--accent)]"
                  onChange={(e) => {
                    const v = new Set(visible);
                    if (e.target.checked) v.add(k);
                    else v.delete(k);
                    setVisible(v);
                  }}
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: POINT_COLOR[k] }} />
                <span className="flex-1">{t(`points.${k}`)}</span>
                <span className="font-mono text-xs text-faint">{points[k]?.length ?? 0}</span>
              </label>
            ))}
          </section>
        )}

        <span className="flex-1" />
        <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={saveAsCamera} onChange={(e) => setSaveAsCamera(e.target.checked)} className="accent-[var(--accent)]" />
            {t("saveAsCamera")}
          </label>
          {saveAsCamera && (
            <input value={cameraName} onChange={(e) => setCameraName(e.target.value)} placeholder={t("cameraNamePlaceholder")} className={FIELD} />
          )}
          <button onClick={submit} disabled={sending} className={`${BUTTON.primary} py-2`}>
            {sending ? t("starting") : t("detect", { n: lines.length })}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
