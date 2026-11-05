"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_LOCALE, SYSTEM_LOCALE, isLocale, matchLocale, parseAcceptLanguage, type Locale } from "@/i18n/locales";
import { chosenLocale, systemLocale } from "@/i18n/server";
import { requireAccess } from "@/lib/access";
import { writeSetting } from "@/lib/db";
import { detectGpu, engineDir, engineStatus, installEngine, installState, gpuPreferred, type EngineStatus, type Gpu, type Installation } from "@/lib/engine";
import { writeVariable } from "@/lib/env";
import { checkKey, type KeyCheck } from "@/lib/openrouter";

export type SettingsState = {
  gpu: Gpu;
  useGpu: boolean;
  /** the app can install the engine by itself (desktop app) */
  canInstall: boolean;
  hasKey: boolean;
  /** "system" or a locale; `system` is the computer's language, shown next to the "system" option */
  language: { chosen: Locale | typeof SYSTEM_LOCALE; system: Locale };
};

/** Result of saving/checking the key; the errors are translated on screen (settings.key.errors.*). */
export type KeyResult = Omit<KeyCheck, "error"> & { error?: KeyCheck["error"] | "spaces" | "incomplete" | "noKey" };

export async function readState(): Promise<SettingsState> {
  await requireAccess();
  // the computer's language: from the desktop app, otherwise the browser's
  const browser = matchLocale(parseAcceptLanguage((await headers()).get("accept-language")));
  return {
    gpu: detectGpu(),
    useGpu: gpuPreferred(), // aliased: the "use" prefix trips the React hooks lint rule
    canInstall: !!engineDir(),
    hasKey: !!process.env.OPENROUTER_API_KEY,
    language: { chosen: chosenLocale() ?? SYSTEM_LOCALE, system: systemLocale() ?? browser ?? DEFAULT_LOCALE },
  };
}

/** Takes a few seconds (Python loads PyTorch to answer). */
export async function checkEngine(): Promise<EngineStatus> {
  await requireAccess();
  return engineStatus();
}

export async function chooseGpu(use: boolean): Promise<void> {
  await requireAccess();
  writeSetting("gpu", use ? "gpu" : "cpu");
}

export async function install(): Promise<void> {
  await requireAccess();
  installEngine();
  refresh(); // the sidebar starts showing the installation in "Tasks in progress"
}

export async function installProgress(): Promise<Installation> {
  await requireAccess();
  const s = installState();
  return { ...s, lines: s.lines.slice(-60) };
}

/** Tests the key on OpenRouter and only saves it if it works. */
export async function saveKey(key: string): Promise<KeyResult> {
  await requireAccess();
  const clean = String(key ?? "").trim();
  if (!clean || /\s/.test(clean)) return { ok: false, balance_usd: null, error: "spaces" };
  // OpenRouter's key list shows only the start and the end ("sk-or-v1-7f8…84f"):
  // the whole key appears only once, right after it is created
  if (/[.…]{1,3}/.test(clean) || (clean.startsWith("sk-or-") && clean.length < 40)) return { ok: false, balance_usd: null, error: "incomplete" };
  const r = await checkKey(clean);
  if (r.ok) writeVariable("OPENROUTER_API_KEY", clean);
  return r;
}

/** Balance of the key already saved (never returns the key itself). */
export async function checkSavedKey(): Promise<KeyResult> {
  await requireAccess();
  const key = process.env.OPENROUTER_API_KEY;
  return key ? checkKey(key) : { ok: false, balance_usd: null, error: "noKey" };
}

/** Changes the app language; refresh() redraws the whole screen in the new language at once. */
export async function setLanguage(value: string): Promise<void> {
  await requireAccess();
  if (!isLocale(value) && value !== SYSTEM_LOCALE) return;
  writeSetting("language", value); // "system" is not a locale: chosenLocale() ignores it
  refresh();
}

export async function finishFirstRun(): Promise<void> {
  await requireAccess();
  writeSetting("first_run", new Date().toISOString());
  redirect("/");
}

export async function redoFirstRun(): Promise<void> {
  await requireAccess();
  writeSetting("first_run", null);
  redirect("/welcome");
}
