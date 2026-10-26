"use client";

import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";

type Theme = "dark" | "light";
/** "system" = no saved choice: follows the computer's theme */
type Choice = "system" | Theme;

const KEY = "tc:theme";
const ORDER: Choice[] = ["system", "dark", "light"];

function savedChoice(): Choice {
  const d = document.documentElement.getAttribute("data-theme");
  return d === "dark" || d === "light" ? d : "system";
}

function systemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const listeners = new Set<() => void>();
function subscribe(f: () => void) {
  listeners.add(f);
  const mq = matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", f);
  return () => {
    listeners.delete(f);
    mq.removeEventListener("change", f);
  };
}

/** Cycles System → Dark → Light; the choice is saved on this computer. */
export function ThemeButton() {
  const t = useTranslations("theme");
  // "system|dark": the choice and the effective theme in one string (stable snapshot)
  const state = useSyncExternalStore(subscribe, () => `${savedChoice()}|${systemTheme()}`, () => null);
  const [choice, system] = (state?.split("|") ?? [null, null]) as [Choice | null, Theme | null];
  const effective: Theme | null = choice === "system" ? system : choice;

  // desktop app: the window buttons follow the page theme
  useEffect(() => {
    const desktop = window.trafficCounterDesktop;
    if (!desktop) return;
    document.documentElement.setAttribute("data-desktop", desktop.platform);
    if (effective) desktop.theme?.(effective);
  }, [effective]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(choice ?? "system") + 1) % ORDER.length];
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    listeners.forEach((f) => f());
  }

  const label = choice === "system" && system ? t("systemWith", { theme: t(system).toLowerCase() }) : choice ? t(choice) : t("theme");
  return (
    <button
      type="button"
      onClick={cycle}
      className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
      aria-label={t("aria", { label })}
      title={t("tooltip")}
      data-testid="theme-button"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
      </svg>
      {label}
    </button>
  );
}
