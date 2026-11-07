"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Category } from "@/lib/db";
import { HIGHLIGHT_DEFAULT, HIGHLIGHT_MAX_S, HIGHLIGHT_MIN_S, type Highlights } from "@/lib/highlights";
import { COUNTED_CATEGORIES } from "@/lib/review";
import { LABEL_COLOR } from "@/lib/ui";
import { CategoryPicker } from "./category-picker";

/** What the final video forms choose: the categories and the format (null = whole video). */
export type FinalChoice = { categories: Category[]; highlights: Highlights | null };

export function initialChoice(categories: Category[] | null = null, highlights: Highlights | null = null): FinalChoice {
  return { categories: categories ?? [...COUNTED_CATEGORIES], highlights };
}

/** Cut categories that are still in the video (null = all of them). */
function cutCategories(c: FinalChoice): Category[] {
  const h = c.highlights;
  return h?.categories ? h.categories.filter((x) => c.categories.includes(x)) : c.categories;
}

/** Can it be sent? (a category, and with passages a category to cut on and valid seconds) */
export function choiceReady(c: FinalChoice): boolean {
  if (!c.categories.length) return false;
  const h = c.highlights;
  if (!h) return true;
  const ok = (s: number) => Number.isFinite(s) && s >= HIGHLIGHT_MIN_S && s <= HIGHLIGHT_MAX_S;
  return ok(h.before_s) && ok(h.after_s) && cutCategories(c).length > 0;
}

/** Arguments for createFinalVideo / renderAgain. */
export function choiceArgs(c: FinalChoice): [Category[], Highlights | null] {
  const h = c.highlights;
  return [c.categories, h && { ...h, categories: h.categories ? cutCategories(c) : null }];
}

export function FinalVideoOptions({ value, onChange }: { value: FinalChoice; onChange: (v: FinalChoice) => void }) {
  const t = useTranslations("finalOptions");
  const tRoot = useTranslations();
  // switching to "whole" and back keeps what was set
  const [last, setLast] = useState<Highlights>(value.highlights ?? { ...HIGHLIGHT_DEFAULT, categories: null });
  const h = value.highlights;
  const setH = (n: Highlights | null) => {
    if (n) setLast(n);
    onChange({ ...value, highlights: n });
  };
  const cuts = cutCategories(value);
  const toggleCut = (c: Category) => {
    if (!h) return;
    const next = cuts.includes(c) ? cuts.filter((x) => x !== c) : value.categories.filter((x) => x === c || cuts.includes(x));
    setH({ ...h, categories: next.length === value.categories.length ? null : next });
  };
  const secs = (key: "before_s" | "after_s", label: string) => (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input
        type="number"
        min={HIGHLIGHT_MIN_S}
        max={HIGHLIGHT_MAX_S}
        step={0.5}
        value={h ? h[key] : ""}
        onChange={(e) => h && setH({ ...h, [key]: e.target.valueAsNumber })}
        className="w-16 rounded border border-line bg-raised px-1.5 py-0.5 text-right font-mono text-fg"
        data-testid={`highlights-${key}`}
      />
      s
    </label>
  );
  const option = (on: boolean, label: string, onClick: () => void, testId: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      data-testid={testId}
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${on ? "bg-accent text-accent-ink" : "text-muted hover:bg-hover hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="final-options">
      <CategoryPicker value={value.categories} onChange={(categories) => onChange({ ...value, categories })} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs text-muted">{t("format")}</legend>
        <div role="radiogroup" aria-label={t("format")} className="flex max-w-sm gap-1 rounded-lg border border-line bg-raised p-0.5">
          {option(!h, t("whole"), () => setH(null), "format-whole")}
          {option(!!h, t("passages"), () => setH(last), "format-passages")}
        </div>
        <p className="text-xs text-faint">{h ? t("passagesHint") : t("wholeHint")}</p>
        {h && (
          <div className="flex flex-col gap-2 rounded-md border border-line p-2" data-testid="highlights-options">
            <div className="flex flex-wrap items-center gap-4">
              {secs("before_s", t("before"))}
              {secs("after_s", t("after"))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">
                {t("cutOn")}
                <button
                  type="button"
                  onClick={() => h && setH({ ...h, categories: cuts.length ? [] : null })}
                  className="ml-2 text-accent-text hover:underline"
                  data-testid="cut-toggle-all"
                >
                  {cuts.length ? t("uncheckAll") : tRoot("categoryPicker.checkAll")}
                </button>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {value.categories.map((c) => {
                  const on = cuts.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleCut(c)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? `${LABEL_COLOR[c].border} bg-raised text-fg` : "border-line text-faint hover:text-muted"}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${on ? LABEL_COLOR[c].bg : "bg-faint"}`} aria-hidden />
                      {tRoot(`categories.plural.${c}`)}
                    </button>
                  );
                })}
              </div>
              {!cuts.length && <p className="text-xs text-danger">{t("noCut")}</p>}
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}
