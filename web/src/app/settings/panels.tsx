"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { LOCALES, LOCALE_NAMES, SYSTEM_LOCALE } from "@/i18n/locales";
import { formatStored } from "@/i18n/message";
import type { EngineStatus, Installation } from "@/lib/engine";
import { INSTALL_STEPS } from "@/lib/install-steps";
import { BUTTON, FIELD } from "@/lib/ui";
import { checkEngine, checkSavedKey, chooseGpu, install, installProgress, saveKey, setLanguage, type KeyResult, type SettingsState } from "./actions";

/**
 * The app's settings, in words for people outside the field: language,
 * graphics card, detection engine and the artificial intelligence key. Used
 * on the first run (/welcome) and in Settings.
 */

/** Language of the whole app; applies at once (the server redraws the screen). */
export function LanguagePanel({ state, compact }: { state: SettingsState; compact?: boolean }) {
  const t = useTranslations("language");
  const id = useId();
  const [value, setValue] = useState<string>(state.language.chosen);
  const [pending, start] = useTransition();

  function choose(v: string) {
    setValue(v);
    start(() => setLanguage(v));
  }

  return (
    <div className={`flex ${compact ? "flex-wrap items-center gap-2" : "flex-col gap-2"}`}>
      <label htmlFor={id} className={compact ? "text-sm text-muted" : "text-sm font-medium"}>
        {t("label")}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          value={value}
          onChange={(e) => choose(e.target.value)}
          disabled={pending}
          className={`${FIELD} ${compact ? "" : "w-full max-w-sm"}`}
          data-testid="language"
        >
          <option value={SYSTEM_LOCALE}>{t("system", { name: LOCALE_NAMES[state.language.system] })}</option>
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-muted">{t("applying")}</span>}
      </div>
      {!compact && <p className="text-sm text-muted">{t("hint")}</p>}
    </div>
  );
}

function Option({ checked, title, text, onChoose, testid }: { checked: boolean; title: string; text: string; onChoose: () => void; testid?: string }) {
  return (
    <button
      type="button"
      role="radio"
      onClick={onChoose}
      aria-checked={checked}
      data-testid={testid}
      className={`flex items-start gap-3 rounded-lg border p-3 text-left ${checked ? "border-accent bg-accent/10" : "border-line bg-raised hover:bg-hover"}`}
    >
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${checked ? "border-accent" : "border-faint"}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted">{text}</span>
      </span>
    </button>
  );
}

export function GpuPanel({ state, onChange }: { state: SettingsState; onChange: (use: boolean) => void }) {
  const t = useTranslations("settings.gpu");
  const [, start] = useTransition();
  const choose = (use: boolean) => {
    onChange(use);
    start(() => chooseGpu(use));
  };

  if (state.gpu.kind === "apple") {
    return <p className="text-sm">{t("apple")}</p>;
  }
  if (state.gpu.kind !== "nvidia") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>{t("noNvidia")}</p>
        <p className="text-muted">{t("noNvidiaHint")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("title")}>
      <Option checked={state.useGpu} title={t("useGpu", { name: state.gpu.name ?? "" })} text={t("useGpuHint")} onChoose={() => choose(true)} testid="use-gpu" />
      <Option checked={!state.useGpu} title={t("useCpu")} text={t("useCpuHint")} onChoose={() => choose(false)} testid="use-cpu" />
    </div>
  );
}

/** Engine status + installation with progress. `onReady` tells the wizard. */
export function EnginePanel({ state, onReady }: { state: SettingsState; onReady?: (ready: boolean) => void }) {
  const t = useTranslations("settings.engine");
  const tr = useTranslations();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [inst, setInst] = useState<Installation | null>(null);
  const [checking, start] = useTransition();

  const check = useCallback(() => {
    start(async () => {
      const s = await checkEngine();
      setStatus(s);
      onReady?.(s.ok);
    });
  }, [onReady]);

  // on open: resume an installation in progress, otherwise check the engine
  useEffect(() => {
    let alive = true;
    installProgress().then((p) => {
      if (!alive) return;
      if (p.running) setInst(p);
      else check();
    });
    return () => {
      alive = false;
    };
  }, [check]);

  // follows the installation
  useEffect(() => {
    if (!inst?.running) return;
    const timer = setInterval(async () => {
      const p = await installProgress();
      setInst(p);
      if (!p.running) {
        clearInterval(timer);
        if (p.ok) check();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [inst?.running, check]);

  function begin() {
    setStatus(null);
    // "" = stage not known yet: shows "Starting…" until the first poll
    setInst({ running: true, ok: null, step: 1, stage: "", lines: [] });
    void install();
  }

  // chose to use the graphics card, but the installed engine is the processor one
  const gpuMismatch = status?.ok && state.gpu.kind === "nvidia" && state.useGpu && !status.gpu;

  if (inst?.running) {
    const stage = inst.stage ? formatStored(tr, inst.stage) : t("starting");
    return (
      <div className="flex flex-col gap-3" data-testid="installing">
        <p className="font-medium">{inst.step ? t("stepOf", { step: inst.step, total: INSTALL_STEPS, stage }) : t("stage", { stage })}</p>
        <span className="indeterminate-bar h-2 rounded-full bg-line" aria-hidden />
        <p className="text-sm text-muted">{inst.step ? t("installTime") : t("quickFix")}</p>
        <Details lines={inst.lines} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!status || checking ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="indeterminate-bar h-1.5 w-24 rounded-full bg-line" aria-hidden />
          {t("checking")}
        </p>
      ) : status.ok ? (
        <div className="flex flex-col gap-1" data-testid="engine-ready">
          <p className="font-medium text-ok">✓ {t("ready")}</p>
          <p className="text-sm text-muted">{status.gpu ? t("usingGpu", { name: status.gpu }) : t("usingCpu")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("notInstalled")}</p>
          <p className="text-sm text-muted">{t("notInstalledHint", { size: state.gpu.kind === "nvidia" && state.useGpu ? "6 GB" : "2 GB" })}</p>
        </div>
      )}

      {inst?.ok === false && <p className="text-sm text-danger">{formatStored(tr, inst.stage)}</p>}
      {gpuMismatch && <p className="text-sm text-warn">{t("gpuMismatch")}</p>}

      {status && !checking && (
        <div className="flex flex-wrap gap-2">
          {state.canInstall && (!status.ok || gpuMismatch) && (
            <button type="button" onClick={begin} className={BUTTON.primary} data-testid="install-engine">
              {inst?.ok === false ? t("tryAgain") : status.ok ? t("reinstall") : t("installNow")}
            </button>
          )}
          {state.canInstall && status.ok && !gpuMismatch && (
            <button type="button" onClick={begin} className={BUTTON.ghost}>
              {t("reinstall")}
            </button>
          )}
          {!state.canInstall && !status.ok && <p className="text-sm text-muted">{t("systemPython")}</p>}
        </div>
      )}
      {status && !status.ok && (
        <Details lines={[status.error ? formatStored(tr, status.error) : t("missing", { list: status.missing?.join(", ") ?? "" }), `Python: ${status.python}`]} />
      )}
      {inst && inst.ok !== null && inst.lines.length > 0 && <Details lines={inst.lines} />}
    </div>
  );
}

function Details({ lines }: { lines: string[] }) {
  const t = useTranslations("settings");
  if (!lines.length) return null;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer">{t("technicalDetails")}</summary>
      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-viewer p-2 font-mono text-[0.7rem] text-white/80">
        {lines.join("\n")}
      </pre>
    </details>
  );
}

const LINK = "font-medium text-accent-text underline";

export function KeyPanel({ hasKey, onReady }: { hasKey: boolean; onReady?: (ready: boolean) => void }) {
  const t = useTranslations("settings.key");
  const format = useFormatter();
  const [saved, setSaved] = useState<KeyResult | null>(null);
  const [key, setKey] = useState("");
  const [result, setResult] = useState<KeyResult | null>(null);
  const [changing, setChanging] = useState(!hasKey);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!hasKey) return;
    let alive = true;
    checkSavedKey().then((r) => {
      if (!alive) return;
      setSaved(r);
      onReady?.(r.ok);
      if (!r.ok) setChanging(true);
    });
    return () => {
      alive = false;
    };
  }, [hasKey, onReady]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await saveKey(key);
      setResult(r);
      if (r.ok) {
        setSaved(r);
        setKey("");
        setChanging(false);
        onReady?.(true);
      }
    });
  }

  const dollars = (v: number) => format.number(v, { style: "currency", currency: "USD" });
  const link = (href: string) =>
    function Link(chunks: React.ReactNode) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className={LINK}>
          {chunks}
        </a>
      );
    };
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{t.rich("intro", { strong })}</p>

      {saved?.ok && !changing && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ok/40 bg-ok/10 p-3" data-testid="key-ok">
          <span className="font-medium text-ok">✓ {t("working")}</span>
          {saved.balance_usd != null && <span className="text-sm">{t("balance", { amount: dollars(saved.balance_usd) })}</span>}
          {saved.balance_usd != null && saved.balance_usd < 1 && <span className="text-sm text-warn">{t("lowBalance")}</span>}
          <span className="flex-1" />
          <button type="button" onClick={() => setChanging(true)} className={BUTTON.ghost}>
            {t("change")}
          </button>
        </div>
      )}
      {hasKey && !saved && <p className="text-sm text-muted">{t("checkingSaved")}</p>}

      {changing && (
        <>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            <li>{t.rich("step1", { link: link("https://openrouter.ai/sign-up") })}</li>
            <li>{t.rich("step2", { link: link("https://openrouter.ai/settings/credits") })}</li>
            <li>
              {t.rich("step3", {
                link: link("https://openrouter.ai/settings/keys"),
                strong,
                code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
              })}
            </li>
            <li>{t("step4")}</li>
          </ol>
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t("placeholder")}
              aria-label={t("fieldLabel")}
              autoComplete="off"
              className={`${FIELD} min-w-0 flex-1 font-mono`}
              data-testid="key-field"
            />
            <button disabled={!key.trim() || pending} className={BUTTON.primary}>
              {pending ? t("testing") : t("testAndSave")}
            </button>
            {saved?.ok && (
              <button type="button" onClick={() => (setChanging(false), setResult(null), setKey(""))} className={BUTTON.ghost}>
                {t("cancel")}
              </button>
            )}
          </form>
          {result && !result.ok && result.error && <p className="text-sm text-danger">{t(`errors.${result.error}`, { status: result.status ?? "" })}</p>}
        </>
      )}
      {result?.ok && !changing && <p className="text-sm text-ok">{t("saved")}</p>}
    </div>
  );
}
