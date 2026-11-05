"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Category, Line } from "@/lib/db";
import { LABEL_COLOR, PANEL_TITLE } from "@/lib/ui";
import { setLineCategories } from "./actions";

const ALL: readonly Category[] = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "motorcycles", "cars", "other"];

/** On/off buttons for the categories a line counts (none off = all). */
export function CategoryChips({ value, onChange, label }: { value: Category[] | undefined; onChange: (v: Category[] | undefined) => void; label: string }) {
  const t = useTranslations();
  const active = value?.length ? value : ALL;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {ALL.map((c) => {
        const on = active.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next = on ? active.filter((x) => x !== c) : [...active, c];
              if (!next.length) return; // a line that counts nothing makes no sense
              onChange(next.length === ALL.length ? undefined : ALL.filter((x) => next.includes(x)));
            }}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
              on ? "border-line bg-raised text-fg" : "border-transparent text-faint line-through"
            }`}
          >
            <span className={`h-2 w-2 rounded-sm ${on ? LABEL_COLOR[c].bg : "border border-faint"}`} />
            {t(`categories.singular.${c}`)}
          </button>
        );
      })}
    </div>
  );
}

/** In the review: changes what each line counts without redoing candidates or suggestions. */
export function LineCategories({ jobId, lines }: { jobId: string; lines: Line[] }) {
  const t = useTranslations("lineCategories");
  const [saving, start] = useTransition();
  if (!lines.length) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line px-4 py-3 text-sm">
      <h2 className={PANEL_TITLE}>
        {t("title")} {saving && <span className="font-normal">· {t("saving")}</span>}
      </h2>
      <p className="text-xs text-muted">{t("hint")}</p>
      {lines.map((l) => (
        <div key={l.id} className="flex flex-col gap-1">
          <span className="text-xs font-medium">{l.name}</span>
          <CategoryChips
            value={l.categories}
            label={t("chipsLabel", { name: l.name })}
            onChange={(v) => start(() => setLineCategories(jobId, { [l.id]: v ?? [] }))}
          />
        </div>
      ))}
    </section>
  );
}
