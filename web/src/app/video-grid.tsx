"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatStored } from "@/i18n/message";
import type { Category, JobStatus } from "@/lib/db";
import { COUNTED_CATEGORIES } from "@/lib/review";
import { BUTTON, FIELD, timecode } from "@/lib/ui";
import { moveToGroup } from "./_shell/actions";
import { createFinalVideo } from "./renders/actions";
import { CategoryPicker } from "./renders/category-picker";

export type GridVideo = {
  id: string;
  name: string;
  local: boolean;
  group: string | null;
  status: JobStatus;
  /** message key of the status (lib/status.ts) */
  statusKey: string;
  working: boolean;
  progress: number;
  /** stored messages (formatStored) */
  message: string | null;
  error: string | null;
  duration_s: number | null;
  thumbnail: string | null;
  reviewed: number;
  total: number;
  counts: number;
  /** why it cannot go into a final video yet (grid.notReady.*; null = it can) */
  blocker: { key: string; values?: Record<string, number> } | null;
};

type Props = { videos: GridVideo[]; groups: { id: string; name: string }[]; currentGroup: string | null };

/**
 * The videos of a group as clips in a media panel. Checking videos opens the
 * action bar: move to another group or build a final video with them (in the
 * chosen order — the counter adds across the videos).
 */
export function VideoGrid({ videos, groups, currentGroup }: Props) {
  const t = useTranslations("grid");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [checked, setChecked] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byId = Object.fromEntries(videos.map((v) => [v.id, v]));
  const existing = checked.filter((id) => byId[id]);
  const ready = videos.filter((v) => !v.blocker);
  const byName = (a: GridVideo, b: GridVideo) => a.name.localeCompare(b.name, locale, { numeric: true });

  function toggle(id: string, range: boolean) {
    setChecked((m) => {
      if (range && last) {
        // Shift+click checks from the last one to this one, like in a file manager
        const ids = videos.map((v) => v.id);
        const [a, b] = [ids.indexOf(last), ids.indexOf(id)].sort((x, y) => x - y);
        return [...new Set([...m, ...ids.slice(a, b + 1)])];
      }
      return m.includes(id) ? m.filter((x) => x !== id) : [...m, id];
    });
    setLast(id);
  }

  function openExport() {
    setError(null);
    setExporting(existing.map((id) => byId[id]).filter((v) => !v.blocker).sort(byName).map((v) => v.id));
  }

  const notReady = existing.filter((id) => byId[id].blocker);

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-5 flex min-h-11 flex-wrap items-center gap-2 border-b border-line bg-app/95 px-5 py-1.5 text-sm backdrop-blur">
        {existing.length ? (
          <>
            <span className="font-medium">{t("selected", { n: existing.length })}</span>
            <button type="button" onClick={() => setChecked([])} className={BUTTON.ghost}>
              {t("clear")}
            </button>
            <span className="mx-1 h-5 w-px bg-line" />
            <label className="flex items-center gap-2 text-muted">
              {t("moveTo")}
              <select
                className={FIELD}
                value=""
                disabled={pending}
                onChange={(e) => {
                  const target = e.target.value === "-" ? null : e.target.value;
                  start(async () => {
                    await moveToGroup(existing, target);
                    setChecked([]);
                  });
                }}
              >
                <option value="" disabled>
                  {t("chooseGroup")}
                </option>
                {groups.filter((g) => g.id !== currentGroup).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="-">{tRoot("library.ungrouped")}</option>
              </select>
            </label>
            <span className="flex-1" />
            {notReady.length > 0 && <span className="text-xs text-muted">{t("leftOut", { n: notReady.length })}</span>}
            <button type="button" onClick={openExport} disabled={existing.length === notReady.length} className={BUTTON.primary}>
              {t("buildFinal")}
            </button>
          </>
        ) : (
          <>
            <span className="text-muted">{t("hint")}</span>
            <span className="flex-1" />
            {ready.length > 0 && (
              <button type="button" onClick={() => setChecked(ready.map((v) => v.id))} className={BUTTON.ghost}>
                {t("checkReviewed", { n: ready.length })}
              </button>
            )}
            <button type="button" onClick={() => setChecked(videos.map((v) => v.id))} className={BUTTON.ghost}>
              {t("checkAll")}
            </button>
          </>
        )}
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4" data-testid="video-grid">
        {videos.map((v) => (
          <Clip key={v.id} v={v} checked={existing.includes(v.id)} onCheck={(range) => toggle(v.id, range)} showGroup={!currentGroup} />
        ))}
      </ul>

      {exporting && (
        <ExportTray
          order={exporting}
          byId={byId}
          setOrder={setExporting}
          error={error ? formatStored(tRoot, error) : null}
          pending={pending}
          onClose={() => setExporting(null)}
          onGenerate={(categories) => start(async () => setError((await createFinalVideo(exporting, categories)).error ?? null))}
        />
      )}
    </div>
  );
}

function Badge({ v }: { v: GridVideo }) {
  const t = useTranslations();
  const complete = v.status === "awaiting_review" && !v.blocker;
  const [text, color] =
    v.status === "error"
      ? [t("status.error"), "bg-danger text-white"]
      : v.status === "awaiting_lines"
        ? [t("grid.badge.drawLines"), "bg-accent text-accent-ink"]
        : complete
          ? [t("grid.badge.reviewed"), "bg-ok text-white"]
          : v.status === "awaiting_review"
            ? [t("grid.badge.review"), "bg-info text-white"]
            : v.status === "suggesting" && !v.working
              ? [t("grid.badge.suggestionsStopped"), "bg-warn text-white"]
              : [t(v.statusKey), "bg-black/70 text-white"];
  // the tooltip says why it cannot go into a final video yet
  const why = v.blocker ? t(`grid.notReady.${v.blocker.key}`, v.blocker.values) : undefined;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[0.7rem] font-semibold ${color}`} title={why}>
      {text}
    </span>
  );
}

function Clip({ v, checked, onCheck, showGroup }: { v: GridVideo; checked: boolean; onCheck: (range: boolean) => void; showGroup: boolean }) {
  const t = useTranslations("grid");
  const tRoot = useTranslations();
  const error = v.error ? formatStored(tRoot, v.error) : null;
  return (
    <li
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-panel ${checked ? "border-accent ring-1 ring-accent" : "border-line hover:border-faint"}`}
      data-testid="video"
    >
      <Link href={`/jobs/${v.id}`} className="flex flex-col">
        <span className="relative block aspect-video bg-viewer">
          {v.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-xs text-faint">
              {v.status === "downloading" ? (v.local ? t("opening") : t("downloading")) : t("noPreview")}
            </span>
          )}
          <span className="absolute right-1.5 top-1.5">
            <Badge v={v} />
          </span>
          {v.duration_s ? (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1 font-mono text-[0.7rem] text-white">{timecode(v.duration_s, true)}</span>
          ) : null}
          {v.working && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50" data-testid="progress">
              <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(v.progress * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="flex flex-col gap-1 px-2.5 py-2">
          <span className="truncate text-sm font-medium" title={v.name}>
            {v.name}
          </span>
          <span className="flex min-h-4 items-center gap-2 text-xs text-muted">
            {v.working ? (
              <span className="truncate font-mono tabular-nums">
                {formatStored(tRoot, v.message)} {v.progress > 0 && `· ${Math.round(v.progress * 100)}%`}
              </span>
            ) : error ? (
              <span className="truncate text-danger" title={error}>
                {error}
              </span>
            ) : v.total > 0 ? (
              <>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                  <span className={`block h-full ${v.reviewed === v.total ? "bg-ok" : "bg-info"}`} style={{ width: `${(v.reviewed / v.total) * 100}%` }} />
                </span>
                <span className="font-mono tabular-nums">
                  {v.reviewed}/{v.total}
                </span>
              </>
            ) : (
              <span>{tRoot(v.statusKey)}</span>
            )}
          </span>
          {(showGroup && v.group) || v.counts > 0 ? (
            <span className="flex gap-2 text-[0.7rem] text-faint">
              {showGroup && v.group && <span className="truncate">{v.group}</span>}
              {v.counts > 0 && <span className="ml-auto shrink-0">{t("counts", { n: v.counts })}</span>}
            </span>
          ) : null}
        </span>
      </Link>
      <label
        className={`absolute left-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-items-center rounded bg-black/60 ${checked ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
        onClick={(e) => {
          e.preventDefault();
          onCheck(e.shiftKey);
        }}
      >
        <input type="checkbox" checked={checked} readOnly aria-label={t("checkVideo", { name: v.name })} className="h-4 w-4 accent-[var(--accent)]" />
      </label>
    </li>
  );
}

type TrayProps = {
  order: string[];
  byId: Record<string, GridVideo>;
  setOrder: (o: string[]) => void;
  /** already translated */
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onGenerate: (categories: Category[]) => void;
};

/** The sequence of the final video, like a track: each video is a block proportional to its duration. */
function ExportTray({ order, byId, setOrder, error, pending, onClose, onGenerate }: TrayProps) {
  const t = useTranslations("grid");
  const total = order.reduce((s, id) => s + (byId[id]?.duration_s ?? 0), 0) || 1;
  const [categories, setCategories] = useState<Category[]>([...COUNTED_CATEGORIES]);
  const move = (i: number, d: number) => {
    const n = [...order];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setOrder(n);
  };
  return (
    <section className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-3 border-t border-line bg-panel px-5 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]" aria-label={t("buildFinalLabel")} data-testid="export-tray">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-semibold">{t("finalVideo")}</h2>
        <span className="text-sm text-muted">{t("traySummary", { n: order.length, duration: timecode(total, true) })}</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={BUTTON.ghost}>
          {t("close")}
        </button>
      </div>
      <div className="flex h-9 overflow-hidden rounded-md border border-line bg-viewer" aria-hidden>
        {order.map((id, i) => (
          <span
            key={id}
            className={`flex min-w-0 items-center border-r border-black/40 px-2 text-[0.7rem] font-medium text-white ${i % 2 ? "bg-info/70" : "bg-info/50"}`}
            style={{ width: `${((byId[id]?.duration_s ?? 0) / total) * 100}%` }}
            title={byId[id]?.name}
          >
            <span className="truncate">{byId[id]?.name}</span>
          </span>
        ))}
      </div>
      <ol className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-sm">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded px-1 hover:bg-hover">
            <span className="w-6 text-right font-mono text-xs text-faint">{i + 1}</span>
            <span className="flex-1 truncate">{byId[id]?.name}</span>
            <span className="font-mono text-xs text-faint">{t("counts", { n: byId[id]?.counts ?? 0 })}</span>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className={BUTTON.ghost} aria-label={t("moveUp", { name: byId[id]?.name ?? id })}>
              ↑
            </button>
            <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} className={BUTTON.ghost} aria-label={t("moveDown", { name: byId[id]?.name ?? id })}>
              ↓
            </button>
            <button type="button" onClick={() => setOrder(order.filter((x) => x !== id))} className={BUTTON.ghost} aria-label={t("remove", { name: byId[id]?.name ?? id })}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <CategoryPicker value={categories} onChange={setCategories} />
      <div className="flex items-center gap-3">
        <button type="button" disabled={!order.length || !categories.length || pending} onClick={() => onGenerate(categories)} className={BUTTON.primary}>
          {pending ? t("sending") : t("generate", { n: order.length })}
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </section>
  );
}
