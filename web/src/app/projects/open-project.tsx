"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import type { ProjectEntry, ProjectError } from "@/lib/project";
import { BUTTON, FIELD } from "@/lib/ui";
import { openProjectFile } from "./actions";

/** The list of project files and "Open another file…" (desktop dialog, or a typed path in the browser). */
export function OpenProject({ projects, folder }: { projects: ProjectEntry[]; folder: string }) {
  const t = useTranslations("project");
  const format = useFormatter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<ProjectError | null>(null);
  const [typed, setTyped] = useState("");
  const desktop = useSyncExternalStore(
    () => () => {},
    () => !!window.trafficCounterDesktop?.openProjectFile,
    () => false,
  );

  function open(file: string) {
    setError(null);
    start(async () => {
      const r = await openProjectFile(file);
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="projects">
      {projects.length ? (
        <ul className="flex flex-col gap-1.5">
          {projects.map((p) => (
            <li key={p.file} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="break-all font-mono text-xs text-faint">{p.file}</span>
                <span className="text-xs text-muted">
                  {t("videos", { n: p.videos })}
                  {p.saved_at && ` · ${t("savedAt", { when: format.dateTime(new Date(p.saved_at), { dateStyle: "short", timeStyle: "short" }) })}`}
                </span>
              </span>
              {p.groupId ? (
                <Link href={`/?group=${p.groupId}`} className={BUTTON.ghost}>
                  {t("alreadyOpen")}
                </Link>
              ) : (
                <button type="button" className={BUTTON.secondary} disabled={busy} onClick={() => open(p.file)} data-testid="open-project">
                  {t("open")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t("none", { folder })}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {desktop ? (
          <button
            type="button"
            className={BUTTON.secondary}
            disabled={busy}
            onClick={async () => {
              const file = await window.trafficCounterDesktop?.openProjectFile?.(folder);
              if (file) open(file);
            }}
          >
            {t("openOther")}
          </button>
        ) : (
          <form
            className="flex flex-1 flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) open(typed.trim());
            }}
          >
            <input className={`${FIELD} min-w-64 flex-1`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("pathPlaceholder")} aria-label={t("openOther")} data-testid="project-path" />
            <button className={BUTTON.secondary} disabled={busy || !typed.trim()}>
              {t("open")}
            </button>
          </form>
        )}
      </div>
      {error && <p className="text-danger" data-testid="project-error">{t(`errors.${error}`)}</p>}
      <p className="text-xs text-muted">{t("openHint")}</p>
    </div>
  );
}
