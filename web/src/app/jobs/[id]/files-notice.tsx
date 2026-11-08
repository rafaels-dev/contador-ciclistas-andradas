"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import { BUTTON, FIELD } from "@/lib/ui";
import { rebuildImages, relocateVideo } from "./actions";

/** Missing files of a video, with what makes them come back (see DeletedFiles in page.tsx). */
export function FilesNotice({
  jobId,
  mediaGone,
  driveGone,
  localGone,
  canRebuild,
  progress,
  failure,
}: {
  jobId: string;
  mediaGone: boolean;
  driveGone: boolean;
  /** the original video's expected path, when it is not there */
  localGone: string | null;
  canRebuild: boolean;
  /** 0–1 while the images are being made again */
  progress: number | null;
  /** why the last attempt to make the images again did not work */
  failure: "wrongVideo" | "failed" | null;
}) {
  const t = useTranslations("job.deleted");
  const [busy, start] = useTransition();
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState<"notFound" | "wrongVideo" | "checkFailed" | null>(null);
  const native = useSyncExternalStore(
    () => () => {},
    () => !!window.trafficCounterDesktop?.pickVideos,
    () => false,
  );

  function relocate(file: string) {
    setRefused(null);
    start(async () => {
      const r = await relocateVideo(jobId, file);
      setRefused(r.error ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn" data-testid="deleted-files">
      {localGone && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1">{t("localVideo", { path: localGone })}</p>
          {native ? (
            <button
              type="button"
              className={BUTTON.secondary}
              disabled={busy}
              onClick={async () => {
                const [file] = (await window.trafficCounterDesktop?.pickVideos?.()) ?? [];
                if (file) relocate(file);
              }}
            >
              {t("locate")}
            </button>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) relocate(typed.trim());
              }}
            >
              <input className={FIELD} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("locatePlaceholder")} aria-label={t("locate")} />
              <button className={BUTTON.secondary} disabled={busy || !typed.trim()}>
                {t("locate")}
              </button>
            </form>
          )}
          {refused && <span className="w-full text-danger">{t(refused)}</span>}
        </div>
      )}
      {driveGone && <p>{t("driveVideo")}</p>}
      {progress !== null ? (
        <div className="flex items-center gap-3" data-testid="rebuilding">
          <span>{t("rebuilding")}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          <span className="font-mono text-xs tabular-nums">{Math.round(progress * 100)}%</span>
        </div>
      ) : (
        mediaGone && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1">
              {t("media")}
              {failure && <span className="block text-danger">{t(failure === "wrongVideo" ? "wrongVideo" : "rebuildFailed")}</span>}
            </p>
            {canRebuild && (
              <button type="button" className={BUTTON.secondary} disabled={busy} onClick={() => start(() => rebuildImages(jobId))} data-testid="rebuild-images">
                {t("rebuild")}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
