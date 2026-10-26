"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatStored } from "@/i18n/message";
import type { Category } from "@/lib/db";
import { COUNTED_CATEGORIES } from "@/lib/review";
import { BUTTON } from "@/lib/ui";
import { renderAgain } from "../actions";
import { CategoryPicker } from "../category-picker";

type JumpProps = {
  s: number;
  children?: React.ReactNode;
  /** mark on the timeline: background color class, position and tooltip */
  mark?: string;
  left?: string;
  title?: string;
};

/** Jumps the final video player to an instant (seconds). */
export function JumpTo({ s, children, mark, left, title }: JumpProps) {
  function jump() {
    const v = document.querySelector<HTMLVideoElement>("video[data-final]");
    if (!v) return;
    v.currentTime = Math.max(0, s - 2);
    void v.play();
  }
  if (mark) {
    return (
      <button
        type="button"
        onClick={jump}
        title={title}
        aria-label={title}
        className={`absolute bottom-1.5 top-1.5 w-1 -translate-x-1/2 rounded-[1px] ${mark} hover:bottom-0.5 hover:top-0.5`}
        style={{ left }}
      />
    );
  }
  return (
    <button type="button" className="font-mono text-xs tabular-nums text-accent-text hover:underline" onClick={jump}>
      {children}
    </button>
  );
}

/** Generates again; `categories` is the choice stored in the render (null = all) and can be changed first. */
export function RenderAgainButton({ renderId, label, categories }: { renderId: string; label: string; categories: Category[] | null }) {
  const t = useTranslations("renderPage");
  const tRoot = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<Category[]>(categories ?? [...COUNTED_CATEGORIES]);
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {editing && <CategoryPicker value={choice} onChange={setChoice} />}
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending || !choice.length} onClick={() => start(async () => setError((await renderAgain(renderId, choice)).error ?? null))} className={BUTTON.secondary}>
          {label}
        </button>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className={BUTTON.ghost}>
            {t("changeCategories")}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-danger">{formatStored(tRoot, error)}</p>}
    </div>
  );
}
