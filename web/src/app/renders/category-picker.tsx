"use client";

import { useTranslations } from "next-intl";
import type { Category } from "@/lib/db";
import { COUNTED_CATEGORIES as CATEGORIES } from "@/lib/review";
import { LABEL_COLOR } from "@/lib/ui";

/**
 * Which categories go into the final video and the count. No choice (null)
 * = all; the list is stored in the render, and "Generate again" keeps it.
 */
export function allCategories(sel: readonly Category[] | null): boolean {
  return !sel || sel.length === CATEGORIES.length;
}

export function CategoryPicker({ value, onChange }: { value: Category[]; onChange: (v: Category[]) => void }) {
  const t = useTranslations("categoryPicker");
  const tRoot = useTranslations();
  const toggle = (c: Category) => onChange(value.includes(c) ? value.filter((x) => x !== c) : CATEGORIES.filter((x) => x === c || value.includes(x)));
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="category-picker">
      <legend className="text-xs text-muted">
        {t("legend")}
        {value.length < CATEGORIES.length && (
          <button type="button" onClick={() => onChange([...CATEGORIES])} className="ml-2 text-accent-text hover:underline">
            {t("checkAll")}
          </button>
        )}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(c)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? `${LABEL_COLOR[c].border} bg-raised text-fg` : "border-line text-faint line-through hover:text-muted"}`}
            >
              <span className={`h-2 w-2 rounded-full ${on ? LABEL_COLOR[c].bg : "bg-faint"}`} aria-hidden />
              {tRoot(`categories.plural.${c}`)}
            </button>
          );
        })}
      </div>
      {!value.length && <p className="text-xs text-danger">{t("none")}</p>}
    </fieldset>
  );
}
