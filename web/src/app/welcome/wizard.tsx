"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
import { BUTTON } from "@/lib/ui";
import { Logo } from "../_shell/title-bar";
import { checkEngine, checkSavedKey, finishFirstRun, type SettingsState } from "../settings/actions";
import { EnginePanel, GpuPanel, KeyPanel, LanguagePanel } from "../settings/panels";

const STEPS = ["gpu", "engine", "ai"] as const;

/**
 * First run: prepares the computer in 3 steps, without technical terms. The
 * language comes first, on the opening screen, so the rest is already read in
 * it. Covers the whole screen (except the title bar, which drags the window).
 */
export function Wizard({ initial }: { initial: SettingsState }) {
  const t = useTranslations("welcome");
  const [state, setState] = useState(initial);
  const [step, setStep] = useState(0); // 0 = welcome, 1–3 = STEPS, 4 = ready
  const [engineReady, setEngineReady] = useState<boolean | null>(null);
  const [keyReady, setKeyReady] = useState<boolean | null>(initial.hasKey ? null : false);
  const [leaving, start] = useTransition();
  const onEngine = useCallback((ok: boolean) => setEngineReady(ok), []);
  const onKey = useCallback((ok: boolean) => setKeyReady(ok), []);

  // checks again on reaching the summary: the engine may have finished
  // installing after the user moved on to step 3 (the panel only reports
  // "not ready" when it opens), and the key may have been saved outside the wizard
  function goToSummary() {
    if (engineReady !== true) {
      setEngineReady(null);
      void checkEngine().then((s) => setEngineReady(s.ok));
    }
    if (keyReady !== true) {
      setKeyReady(null);
      void checkSavedKey().then((r) => setKeyReady(r.ok));
    }
    setStep(4);
  }
  const checking = step === 4 && (engineReady === null || keyReady === null);

  const pending = [engineReady !== true && "engineMissing", keyReady !== true && "keyMissing"].filter(Boolean) as ("engineMissing" | "keyMissing")[];

  return (
    <div className="fixed inset-x-0 bottom-0 top-10 z-40 overflow-y-auto bg-app" data-testid="welcome">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-10">
        {step > 0 && step < 4 && (
          <ol className="flex items-center gap-2 text-xs" aria-label={t("stepsLabel")}>
            {STEPS.map((name, i) => (
              <li key={name} className="flex flex-1 flex-col gap-1.5" aria-current={step === i + 1 ? "step" : undefined}>
                <span className={`h-1 rounded-full ${i + 1 <= step ? "bg-accent" : "bg-line"}`} />
                <span className={i + 1 === step ? "font-semibold text-fg" : "text-faint"}>
                  {i + 1}. {t(`${name}.title`)}
                </span>
              </li>
            ))}
          </ol>
        )}

        {step === 0 && (
          <section className="flex flex-1 flex-col justify-center gap-5">
            <LanguagePanel state={state} compact />
            <Logo className="h-14 w-14" />
            <h1 className="font-display text-3xl font-semibold">{t("title")}</h1>
            <p className="text-muted">{t("intro")}</p>
            <p className="text-muted">{t("prepare")}</p>
            <button type="button" onClick={() => setStep(1)} className={`${BUTTON.primary} self-start px-5 py-2.5 text-base`}>
              {t("start")}
            </button>
          </section>
        )}

        {step === 1 && (
          <Step title={t("gpu.title")} text={t("gpu.text")}>
            <GpuPanel state={state} onChange={(use) => setState((s) => ({ ...s, useGpu: use }))} />
          </Step>
        )}

        {step === 2 && (
          <Step title={t("engine.title")} text={t("engine.text")}>
            <EnginePanel state={state} onReady={onEngine} />
          </Step>
        )}

        {step === 3 && (
          <Step title={t("ai.title")} text={t("ai.text")}>
            <KeyPanel hasKey={state.hasKey || keyReady === true} onReady={onKey} />
          </Step>
        )}

        {step === 4 && (
          <section className="flex flex-1 flex-col justify-center gap-4">
            <h1 className="font-display text-3xl font-semibold">{checking ? t("checking") : pending.length ? t("almostReady") : t("allReady")}</h1>
            {checking ? null : pending.length ? (
              <>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-warn">
                  {pending.map((p) => (
                    <li key={p}>{t(p)}</li>
                  ))}
                </ul>
                <p className="text-sm text-muted">{t("finishLater")}</p>
              </>
            ) : (
              <p className="text-muted">{t("startImporting")}</p>
            )}
            <button type="button" disabled={leaving} onClick={() => start(() => finishFirstRun())} className={`${BUTTON.primary} self-start px-5 py-2.5 text-base`}>
              {t("openApp")}
            </button>
          </section>
        )}

        {step > 0 && step < 4 && (
          <nav className="mt-auto flex items-center gap-3 border-t border-line pt-4">
            <button type="button" onClick={() => setStep(step - 1)} className={BUTTON.ghost}>
              {t("back")}
            </button>
            <span className="flex-1" />
            {step === 2 && engineReady !== true && <span className="text-xs text-muted">{t("continueWhileInstalling")}</span>}
            <button
              type="button"
              onClick={() => (step === 3 ? goToSummary() : setStep(step + 1))}
              className={(step === 2 && engineReady !== true) || (step === 3 && keyReady !== true) ? BUTTON.secondary : BUTTON.primary}
              data-testid="next"
            >
              {step === 3 && keyReady !== true ? t("later") : t("next")}
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}

function Step({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="text-muted">{text}</p>
      </div>
      <div className="rounded-lg border border-line bg-panel p-4">{children}</div>
    </section>
  );
}
