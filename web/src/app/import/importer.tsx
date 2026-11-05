"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FIELD, PANEL_TITLE } from "@/lib/ui";
import { LocalPicker } from "../local-picker";
import { NewJobForm } from "../new-job-form";

/** `roots`: videos from the computer are allowed on this server (lib/local-files.ts). */
type Props = { groups: { id: string; name: string }[]; initialGroup: string; roots: boolean };

export function Importer({ groups, initialGroup, roots }: Props) {
  const t = useTranslations("import");
  const tRoot = useTranslations();
  const [group, setGroup] = useState(initialGroup);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
          <p className="max-w-2xl text-sm text-muted">{t("intro")}</p>
        </div>
        <span className="flex-1" />
        {groups.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            {t("putInGroup")}
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={FIELD} data-testid="target-group">
              <option value="">{tRoot("library.ungrouped")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div className={`grid gap-4 ${roots ? "lg:grid-cols-2" : ""}`}>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
          <h2 className={PANEL_TITLE}>Google Drive</h2>
          <p className="text-sm text-muted">{t("driveHint")}</p>
          <NewJobForm group={group} />
        </section>
        {roots && (
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
            <h2 className={PANEL_TITLE}>{t("fromComputer")}</h2>
            <p className="text-sm text-muted">{t("computerHint")}</p>
            <LocalPicker group={group} />
          </section>
        )}
      </div>
    </div>
  );
}
