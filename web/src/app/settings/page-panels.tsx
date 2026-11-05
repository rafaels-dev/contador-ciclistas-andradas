"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PANEL_TITLE } from "@/lib/ui";
import type { SettingsState } from "./actions";
import { EnginePanel, GpuPanel, KeyPanel, LanguagePanel } from "./panels";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h2 className={PANEL_TITLE}>{title}</h2>
      {children}
    </section>
  );
}

export function Panels({ initial }: { initial: SettingsState }) {
  const t = useTranslations("settings");
  const [state, setState] = useState(initial);
  return (
    <>
      <Section title={t("languageTitle")}>
        <LanguagePanel state={state} />
      </Section>
      <Section title={t("gpu.title")}>
        <GpuPanel state={state} onChange={(use) => setState((s) => ({ ...s, useGpu: use }))} />
      </Section>
      <Section title={t("engine.title")}>
        <EnginePanel state={state} />
      </Section>
      <Section title={t("key.title")}>
        <KeyPanel hasKey={state.hasKey} />
      </Section>
    </>
  );
}
