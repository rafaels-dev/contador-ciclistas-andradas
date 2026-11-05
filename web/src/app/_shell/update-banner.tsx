"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BUTTON } from "@/lib/ui";

/**
 * "Version X ready — Restart and update". The new version is downloaded in
 * the background and is also installed when the app closes; the banner is for
 * those who leave the app open and did not know that. "Later" hides it until
 * the next start. Outside the desktop app (browser), it does not show.
 */
export function UpdateBanner({ busy }: { busy: number }) {
  const t = useTranslations("update");
  const [state, setState] = useState<UpdateState | null>(null);
  const [later, setLater] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const bridge = window.trafficCounterDesktop?.update;
    if (!bridge) return;
    let alive = true;
    bridge.state().then((e) => alive && setState(e));
    const stop = bridge.onChange((e) => setState(e));
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (!state || state.phase !== "ready" || later) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm" role="status" data-testid="update-banner">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{state.version ? t("readyVersion", { version: state.version }) : t("ready")}</strong>{" "}
        {busy > 0 ? <span className="text-warn">{t("busy", { n: busy })}</span> : <span className="text-muted">{t("installerHint")}</span>}
      </span>
      <button
        type="button"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          window.trafficCounterDesktop?.update?.install();
        }}
        className={busy > 0 ? BUTTON.secondary : BUTTON.primary}
        data-testid="restart-update"
      >
        {restarting ? t("restarting") : busy > 0 ? t("interruptAndUpdate") : t("restartAndUpdate")}
      </button>
      <button type="button" onClick={() => setLater(true)} className={BUTTON.ghost}>
        {t("later")}
      </button>
    </div>
  );
}
