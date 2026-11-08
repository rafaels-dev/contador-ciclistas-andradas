"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useSyncExternalStore, useTransition } from "react";
import type { Group } from "@/lib/db";
import type { ProjectError } from "@/lib/project";
import { BUTTON } from "@/lib/ui";
import { proposedProjectFile, saveGroupProject } from "./projects/actions";

/** "Save project" / "Save as…" of a library group (lib/project.ts), with where and when it was saved. */
export function ProjectButtons({ group }: { group: Group }) {
  const t = useTranslations("project");
  const format = useFormatter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<ProjectError | null>(null);
  const desktop = useSyncExternalStore(
    () => () => {},
    () => !!window.trafficCounterDesktop?.saveProjectFile,
    () => false,
  );

  function save(file?: string) {
    setError(null);
    start(async () => {
      const r = await saveGroupProject(group.id, file);
      if (r.error) setError(r.error);
    });
  }

  async function saveAs() {
    const proposed = await proposedProjectFile(group.id);
    const file = await window.trafficCounterDesktop?.saveProjectFile?.(proposed ?? "");
    if (file) save(file);
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-xs text-muted sm:order-last" data-testid="project-buttons">
      <button type="button" className={BUTTON.secondary} disabled={busy} onClick={() => save()} data-testid="save-project">
        {busy ? t("saving") : t("save")}
      </button>
      {desktop && (
        <button type="button" className={BUTTON.ghost} disabled={busy} onClick={saveAs}>
          {t("saveAs")}
        </button>
      )}
      {group.project_file ? (
        <span className="min-w-0 break-all" data-testid="project-file">
          {t("savedTo", {
            file: group.project_file,
            when: group.project_saved_at ? format.dateTime(new Date(group.project_saved_at), { dateStyle: "short", timeStyle: "short" }) : "—",
          })}
          {desktop && (
            <button
              type="button"
              className="ml-2 underline hover:text-fg"
              onClick={() => window.trafficCounterDesktop?.openFolder?.(group.project_file!.replace(/[\\/][^\\/]*$/, ""))}
            >
              {t("openFolder")}
            </button>
          )}
        </span>
      ) : (
        <span>{t("notSaved")}</span>
      )}
      {error && <span className="text-danger">{t(`errors.${error}`)}</span>}
    </div>
  );
}
