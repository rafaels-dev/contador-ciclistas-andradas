import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { LOG_FILE } from "@/lib/diagnostics";
import { enginePython } from "@/lib/engine";
import { ENV_FILE } from "@/lib/env";
import { suggestionModels } from "@/lib/openrouter";
import { DATA_DIR } from "@/lib/paths";
import { BUTTON, PANEL_TITLE } from "@/lib/ui";
import { readState, redoFirstRun } from "./actions";
import { Panels } from "./page-panels";
import { PageLoading } from "@/app/_shell/page-loading";

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const t = await getTranslations("settings");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5">
      <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
      <Panels initial={await readState()} />
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
        <h2 className={PANEL_TITLE}>{t("help.title")}</h2>
        <p className="text-sm">{t("help.text")}</p>
        <div>
          <a href="/api/diagnostics" className={BUTTON.secondary} data-testid="save-diagnostics">
            {t("help.save")}
          </a>
        </div>
      </section>
      <details className="rounded-lg border border-line bg-panel p-4 text-sm">
        <summary className={`${PANEL_TITLE} cursor-pointer`}>{t("technicalDetails")}</summary>
        <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted">{t("tech.version")}</dt>
          <dd className="font-mono">{process.env.TRAFFIC_COUNTER_VERSION ?? t("tech.development")}</dd>
          <dt className="text-muted">{t("tech.models")}</dt>
          <dd className="font-mono" title={t("tech.modelsHint")}>
            {suggestionModels().join(" → ")}
          </dd>
          <dt className="text-muted">{t("tech.log")}</dt>
          <dd className="break-all font-mono">{LOG_FILE}</dd>
          <dt className="text-muted">{t("tech.data")}</dt>
          <dd className="break-all font-mono">{DATA_DIR}</dd>
          <dt className="text-muted">{t("tech.config")}</dt>
          <dd className="break-all font-mono">{ENV_FILE}</dd>
          <dt className="text-muted">{t("tech.python")}</dt>
          <dd className="break-all font-mono">{enginePython()}</dd>
        </dl>
        <form action={redoFirstRun} className="mt-4">
          <button className={BUTTON.secondary}>{t("redoFirstRun")}</button>
        </form>
      </details>
    </div>
  );
}
