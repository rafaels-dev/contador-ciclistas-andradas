"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import type { MovePlan, MoveState } from "@/lib/move";
import type { FolderError, FolderKind, Kind, Usage } from "@/lib/storage";
import { BUTTON, FIELD } from "@/lib/ui";
import { deleteFiles, moveOldFinals, moveProgress, planFolder, readStorage, setFolder } from "./actions";

const FOLDERS: FolderKind[] = ["temp", "finals", "project"];
const KINDS: Kind[] = ["finalVideos", "reviewMedia", "driveVideos", "leftovers"];

/** "21.4 GB" / "310 MB" in the app language. */
function useBytes() {
  const format = useFormatter();
  return (n: number) => {
    const [value, unit] = n >= 1e9 ? [n / 1e9, "gigabyte"] : [n / 1e6, "megabyte"];
    return format.number(value, { style: "unit", unit, maximumFractionDigits: value < 10 ? 1 : 0 });
  };
}

/** Desktop app: native folder dialog and "Open folder" (only exist after hydration). */
function useDesktop() {
  return useSyncExternalStore(
    () => () => {},
    () => !!window.trafficCounterDesktop?.pickFolder,
    () => false,
  );
}

type Asking = { folder: string | null; plan: MovePlan };

/**
 * One of the three folders: where it is, how much it holds, and the choice of
 * another place — asking first whether what is already there goes along.
 */
function FolderRow({
  kind,
  usage,
  onUsage,
  onMove,
  moving,
}: {
  kind: FolderKind;
  usage: Usage;
  onUsage: (u: Usage) => void;
  /** a move starts (true: clear the previous result) or has been started (false: follow it) */
  onMove: (starting: boolean) => void;
  moving: boolean;
}) {
  const t = useTranslations("settings.storage");
  const bytes = useBytes();
  const desktop = useDesktop();
  const info = usage.folders[kind];
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<FolderError | "busy" | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, start] = useTransition();

  /** First what would move; nothing there → change at once, otherwise ask. */
  function choose(folder: string | null) {
    setError(null);
    start(async () => {
      const plan = await planFolder(kind, folder);
      if ("error" in plan) return setError(plan.error);
      if (plan.items === 0) return apply(folder, false);
      setAsking({ folder, plan });
    });
  }

  function apply(folder: string | null, move: boolean) {
    setAsking(null);
    if (move) onMove(true);
    start(async () => {
      const r = await setFolder(kind, folder, move);
      setError(r.error);
      onUsage(r.usage);
      if (!r.error) {
        setTyped("");
        if (move) onMove(false);
      }
    });
  }

  const fits = asking && (asking.plan.free === null || asking.plan.free > asking.plan.bytes);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-3" data-testid={`folder-${kind}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{t(`folders.${kind}.title`)}</span>
        <span className="font-mono text-xs tabular-nums text-muted">
          {t("used", { size: bytes(info.bytes) })}
          {info.free !== null && ` · ${t("free", { size: bytes(info.free) })}`}
        </span>
      </div>
      <p className="text-xs text-muted">{t(`folders.${kind}.hint`)}</p>
      <div className="flex flex-wrap items-center gap-2 rounded bg-raised px-2 py-1.5">
        <span className="min-w-0 flex-1 break-all font-mono text-xs" data-testid={`folder-${kind}-path`}>
          {info.path}
        </span>
        <span className="text-[0.7rem] text-faint">{info.isDefault ? t("default") : t("chosen")}</span>
      </div>
      {asking ? (
        <div className="flex flex-col gap-2 rounded-md border border-accent/50 bg-accent/10 p-2.5" data-testid={`folder-${kind}-ask`}>
          <p>{t("askMove", { size: bytes(asking.plan.bytes), n: asking.plan.items, path: asking.plan.target })}</p>
          {asking.plan.busy && <p className="text-warn">{t("moveBusy")}</p>}
          {!fits && <p className="text-danger">{t("moveNoSpace", { free: bytes(asking.plan.free ?? 0) })}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON.primary}
              disabled={busy || asking.plan.busy || !fits}
              onClick={() => apply(asking.folder, true)}
              data-testid={`folder-${kind}-move`}
            >
              {t("moveAll")}
            </button>
            <button type="button" className={BUTTON.secondary} disabled={busy} onClick={() => apply(asking.folder, false)} data-testid={`folder-${kind}-keep`}>
              {t("moveNone")}
            </button>
            <button type="button" className={BUTTON.ghost} onClick={() => setAsking(null)}>
              {t("cancel")}
            </button>
          </div>
          <p className="text-xs text-muted">{t("moveHow")}</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {desktop ? (
            <>
              <button type="button" className={BUTTON.ghost} onClick={() => window.trafficCounterDesktop?.openFolder?.(info.path)}>
                {t("open")}
              </button>
              <button
                type="button"
                className={BUTTON.secondary}
                disabled={busy || moving}
                onClick={async () => {
                  const folder = await window.trafficCounterDesktop?.pickFolder?.();
                  if (folder) choose(folder);
                }}
                data-testid={`folder-${kind}-choose`}
              >
                {t("choose")}
              </button>
            </>
          ) : (
            <form
              className="flex flex-1 flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) choose(typed);
              }}
            >
              <input
                className={`${FIELD} min-w-48 flex-1`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("placeholder")}
                aria-label={t("choose")}
                data-testid={`folder-${kind}-input`}
              />
              <button className={BUTTON.secondary} disabled={busy || moving || !typed.trim()}>
                {t("use")}
              </button>
            </form>
          )}
          {!info.isDefault && (
            <button type="button" className={BUTTON.ghost} onClick={() => choose(null)} disabled={busy || moving} data-testid={`folder-${kind}-reset`}>
              {t("backToDefault")}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-danger">{error === "busy" ? t("moveBusy") : t(`errors.${error}`)}</p>}
    </div>
  );
}

/**
 * The three folders (temporary files, final videos, project files), moving
 * their content to another disk, and what can be deleted to free space. See
 * lib/storage.ts and lib/move.ts.
 */
export function StoragePanel() {
  const t = useTranslations("settings.storage");
  const bytes = useBytes();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [chosen, setChosen] = useState<Kind[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [deleting, startDelete] = useTransition();
  const moving = !!move?.running;

  const follow = useCallback(() => {
    moveProgress().then((r) => {
      setMove(r.state);
      if (r.usage) setUsage(r.usage);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    readStorage().then((u) => alive && setUsage(u));
    // a move started before the page opened
    moveProgress(false).then((r) => alive && r.state.running && setMove(r.state));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(follow, 1000);
    return () => clearInterval(timer);
  }, [moving, follow]);

  function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startDelete(async () => {
      const r = await deleteFiles(chosen);
      setFreed(r.freed);
      setUsage(r.usage);
      setChosen([]);
    });
  }

  if (!usage) return <p className="text-sm text-muted">{t("measuring")}</p>;
  const selected = KINDS.filter((k) => chosen.includes(k)).reduce((s, k) => s + usage.kinds[k].bytes, 0);
  const busy = deleting || moving;

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="storage">
      <div className="flex flex-col gap-2">
        {FOLDERS.map((k) => (
          <FolderRow key={k} kind={k} usage={usage} onUsage={setUsage} onMove={(starting) => (starting ? setMove(null) : follow())} moving={moving} />
        ))}
        <p className="text-xs text-muted">{t("nextOnly", { size: bytes(usage.data.bytes), path: usage.data.path })}</p>
      </div>

      {move && (
        <div className="flex flex-col gap-1.5 rounded-md border border-info/40 bg-info/10 p-3" data-testid="moving">
          {move.running ? (
            <>
              <div className="flex items-center gap-3">
                <span>{t("movingItem", { name: move.current ?? "", done: bytes(move.copied), total: bytes(move.total) })}</span>
                <span className="font-mono text-xs tabular-nums">{move.total ? Math.round((move.copied / move.total) * 100) : 0}%</span>
              </div>
              <span className="h-1.5 overflow-hidden rounded-full bg-line">
                <span className="block h-full bg-accent transition-all" style={{ width: `${move.total ? Math.round((move.copied / move.total) * 100) : 0}%` }} />
              </span>
              <span className="text-xs text-muted">{t("movingHint")}</span>
            </>
          ) : (
            <span className={move.failed ? "text-danger" : "text-ok"} data-testid="moved">
              {move.failed ? t("movedSome", { size: bytes(move.total), n: move.failed }) : t("moved", { size: bytes(move.total) })}
            </span>
          )}
        </div>
      )}

      {usage.oldFinals.items > 0 && !moving && (
        <div className="flex flex-col gap-2 rounded-md border border-info/40 bg-info/10 p-3" data-testid="old-finals">
          <p>{t("oldFinals", { n: usage.oldFinals.items, size: bytes(usage.oldFinals.bytes) })}</p>
          <div>
            <button
              type="button"
              className={BUTTON.secondary}
              disabled={busy}
              onClick={async () => {
                setMove(null);
                const r = await moveOldFinals();
                if (!r.error) follow();
              }}
              data-testid="move-old-finals"
            >
              {t("moveOldFinals")}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{t("freeTitle")}</h3>
        <ul className="flex flex-col gap-1.5">
          {KINDS.map((k) => {
            const { bytes: n, items } = usage.kinds[k];
            return (
              <li key={k}>
                <label className={`flex items-start gap-2.5 rounded-md border border-line p-2.5 ${n ? "cursor-pointer hover:bg-hover" : "opacity-60"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={!n || busy}
                    checked={chosen.includes(k)}
                    onChange={(e) => {
                      setConfirming(false);
                      setFreed(null);
                      setChosen((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)));
                    }}
                    data-testid={`storage-${k}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{t(`kinds.${k}.title`)}</span>
                      <span className="font-mono text-xs tabular-nums text-muted">{n ? `${bytes(n)} · ${t("items", { n: items })}` : t("nothing")}</span>
                    </span>
                    <span className="text-xs text-muted">{t(`kinds.${k}.hint`)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={confirming ? BUTTON.danger : BUTTON.secondary} disabled={!selected || busy} onClick={remove} data-testid="storage-delete">
            {deleting ? t("deleting") : confirming ? t("confirm", { size: bytes(selected) }) : selected ? t("delete", { size: bytes(selected) }) : t("deleteNone")}
          </button>
          {confirming && (
            <button type="button" className={BUTTON.ghost} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </button>
          )}
          {freed !== null && !deleting && (
            <span className="text-ok" data-testid="storage-freed">
              {t("freed", { size: bytes(freed) })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
