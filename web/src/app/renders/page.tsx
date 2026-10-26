import Link from "next/link";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { formatStored } from "@/i18n/message";
import { renderWorking } from "@/lib/activity";
import { listRenders } from "@/lib/db";
import { AutoRefresh } from "../jobs/[id]/auto-refresh";
import { PageLoading } from "@/app/_shell/page-loading";

const COLOR = { queued: "text-muted", rendering: "text-accent-text", ready: "text-ok", error: "text-danger" } as const;

/** "2026-10-23 14:05:00" (UTC, from SQLite) → "23/10 11:05" in the computer's time zone. */
function when(utc: string, locale: string): string {
  return new Date(`${utc.replace(" ", "T")}Z`).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function RendersPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const t = await getTranslations("renders");
  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("intro")}</p>
      </header>
      <List />
    </div>
  );
}

async function List() {
  await connection();
  const t = await getTranslations();
  const locale = await getLocale();
  const renders = listRenders();
  if (!renders.length) return <p className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-muted">{t("renders.empty")}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
      {renders.some(renderWorking) && <AutoRefresh ms={2000} />}
      {renders.map((r) => {
        const n = (JSON.parse(r.jobs) as string[]).length;
        return (
          <li key={r.id}>
            <Link href={`/renders/${r.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-hover">
              <span className="flex items-center gap-4">
                <span className="flex-1 truncate font-medium">{r.name}</span>
                <span className="shrink-0 font-mono text-xs text-faint">
                  {t("renders.videos", { n })} · {when(r.created_at, locale)}
                </span>
                <span className={`w-16 shrink-0 text-right text-sm font-medium ${COLOR[r.status]}`}>{t(`renders.status.${r.status}`)}</span>
              </span>
              {renderWorking(r) && (
                <span className="flex items-center gap-3 text-xs text-muted" data-testid="progress">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full bg-accent" style={{ width: `${Math.round(r.progress * 100)}%` }} />
                  </span>
                  <span className="font-mono tabular-nums">{formatStored(t, r.message)}</span>
                </span>
              )}
              {r.status === "ready" && r.message && <span className="text-xs text-muted">{formatStored(t, r.message)}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
