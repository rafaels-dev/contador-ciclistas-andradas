"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { formatStored } from "@/i18n/message";
import { BUTTON, FIELD } from "@/lib/ui";
import { createJobsFromFolder, newJob, type NewJobState } from "./actions";

export function NewJobForm({ group }: { group: string }) {
  const t = useTranslations("newJob");
  const tRoot = useTranslations();
  const [state, action, sending] = useActionState<NewJobState, FormData>(newJob, {});

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="group" value={group} />
        <div className="flex gap-2">
          <input name="link" required placeholder="https://drive.google.com/…" aria-label={t("linkLabel")} className={`${FIELD} min-w-0 flex-1`} />
          <button disabled={sending} className={BUTTON.primary}>
            {sending ? t("opening") : t("open")}
          </button>
        </div>
        {state.error && <p className="text-sm text-danger">{formatStored(tRoot, state.error)}</p>}
      </form>

      {state.folder && (
        <form key={state.folder.id} action={createJobsFromFolder} className="flex flex-col gap-3">
          <input type="hidden" name="group" value={group} />
          <p className="text-sm font-medium">{t("folderVideos", { n: state.folder.files.length })}</p>
          <ul className="flex max-h-80 flex-col overflow-y-auto rounded-md border border-line bg-raised text-sm">
            {state.folder.files.map((f) => (
              <li key={f.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-hover">
                  <input type="checkbox" name="file" value={`${f.id}|${f.name}`} className="accent-[var(--accent)]" />
                  <span className="truncate">{f.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className={`${BUTTON.primary} self-start`}>{t("importChecked")}</button>
        </form>
      )}
    </div>
  );
}
