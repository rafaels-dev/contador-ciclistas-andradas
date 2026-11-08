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
import { changeFolder, moveOldFinals as startOldFinals, moveState, planFolderMove, type MovePlan, type MoveState } from "@/lib/move";
import { FOLDERS, KINDS, freeSpace, storageUsage, type FolderError, type FolderKind, type Kind, type Usage } from "@/lib/storage";

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

/** Space used by each folder and by each kind of file (walks the folders: called after the page opens). */
export async function readStorage(): Promise<Usage> {
  await requireAccess();
  return storageUsage();
}

/** Deletes the chosen kinds of files; returns the new usage and the bytes freed. */
export async function deleteFiles(kinds: string[]): Promise<{ freed: number; usage: Usage }> {
  await requireAccess();
  const freed = freeSpace(kinds.filter((k): k is Kind => (KINDS as readonly string[]).includes(k)));
  return { freed, usage: storageUsage() };
}

/** What would move if a folder changed (asked before changing it). */
export async function planFolder(kind: string, folder: string | null): Promise<MovePlan | { error: FolderError }> {
  await requireAccess();
  if (!(FOLDERS as readonly string[]).includes(kind)) return { error: "notAbsolute" };
  return planFolderMove(kind as FolderKind, folder === null ? null : String(folder));
}

/** New place for one of the folders (null = back to the default); `move` also moves what is already there. */
export async function setFolder(kind: string, folder: string | null, move = false): Promise<{ error: FolderError | "busy" | null; usage: Usage }> {
  await requireAccess();
  if (!(FOLDERS as readonly string[]).includes(kind)) return { error: "notAbsolute", usage: storageUsage() };
  const error = changeFolder(kind as FolderKind, folder === null ? null : String(folder), !!move);
  return { error, usage: storageUsage() };
}

/** Moves the final videos from before 0.0.10 to the final videos folder (in the background). */
export async function moveOldFinals(): Promise<{ error: "busy" | null }> {
  await requireAccess();
  return { error: startOldFinals() };
}

/** Progress of a move; with `measure`, the usage again once it has finished. */
export async function moveProgress(measure = true): Promise<{ state: MoveState; usage: Usage | null }> {
  await requireAccess();
  const state = moveState();
  return { state, usage: state.running || !measure ? null : storageUsage() };
}
