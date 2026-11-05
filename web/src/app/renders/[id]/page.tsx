import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { formatStored } from "@/i18n/message";
import { CATEGORIES, getJob, getRender, listCandidates, type Category } from "@/lib/db";
import { renderDir } from "@/lib/paths";
import { BUTTON, LABEL_COLOR, PANEL_TITLE, timecode } from "@/lib/ui";
import { AutoRefresh } from "../../jobs/[id]/auto-refresh";
import { cancel } from "../actions";
import { JumpTo, RenderAgainButton } from "./controls";
import { PageLoading } from "@/app/_shell/page-loading";

// renders made before the English version had Portuguese keys:
// lib/legacy.ts rewrites relatorio.json/plano.json into these at startup
type Report = {
  generated_at: string;
  totals: Record<string, Partial<Record<Category, number>>>;
  by_direction: Record<string, Partial<Record<Category, Record<string, number>>>>;
  videos: { title: string; start_in_final_s: number; duration_s: number; totals: Record<string, Partial<Record<Category, number>>> }[];
  events: { video: string; candidate: number; line: string; category: Category; direction: string; time_in_video_s: number; time_in_final_s: number }[];
};

/** `job` is missing in plans migrated from older versions: the position in render.jobs stands for it. */
type Plan = { videos: { job?: string; events: { id: number; category: string }[] }[] };

const hms = (s: number) => timecode(Math.round(s), true);

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export default function RenderPage(props: PageProps<"/renders/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <RenderDetail params={props.params} />
    </Suspense>
  );
}

async function RenderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const render = getRender(id);
  if (!render) notFound();
  const tRoot = await getTranslations();
  const t = await getTranslations("renderPage");
  const dir = renderDir(id);
  const base = `/api/renders/${id}/files`;
  const working = render.status === "queued" || render.status === "rendering";
  const jobs = JSON.parse(render.jobs) as string[];
  const renderCategories = render.categories ? (JSON.parse(render.categories) as Category[]) : null;
  const rep = render.status === "ready" ? readJson<Report>(path.join(dir, "report.json")) : null;
  const version = encodeURIComponent(render.updated_at);
  const statusText = t(`status.${render.status}`);
  const catName = (c: Category) => tRoot(`categories.singular.${c}`);

  // did the review change after the request? (the plan freezes the decisions)
  const plan = readJson<Plan>(path.join(dir, "plan.json"));
  const outdated =
    render.status === "ready" &&
    plan?.videos.some((v, i) => {
      const current = listCandidates(v.job ?? jobs[i])
        .filter((c) => c.label && c.label !== "discarded" && (!renderCategories || renderCategories.includes(c.label)))
        .map((c) => `${c.id}:${c.label}`)
        .sort()
        .join(",");
      return current !== v.events.map((e) => `${e.id}:${e.category}`).sort().join(",");
    });

  const lineNames = rep ? Object.keys(rep.totals) : [];
  const cats = CATEGORIES.filter((c) => lineNames.some((l) => rep?.totals[l]?.[c]));
  const totalDuration = rep ? rep.videos.reduce((s, v) => Math.max(s, v.start_in_final_s + v.duration_s), 0) || 1 : 1;
  const pct = (s: number) => `${(s / totalDuration) * 100}%`;
  const message = formatStored(tRoot, render.message);

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {working && <AutoRefresh ms={2000} />}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label={t("breadcrumb")}>
          <Link href="/renders" className="shrink-0 text-muted hover:text-fg">
            {tRoot("renders.title")}
          </Link>
          <span className="text-faint">/</span>
          <h1 className="truncate font-semibold" title={render.name}>
            {render.name}
          </h1>
        </nav>
        <span className="font-mono text-[0.7rem] text-faint">
          {statusText} · {tRoot("renders.videos", { n: jobs.length })}
          {render.status === "ready" && message ? ` · ${message}` : ""}
        </span>
        {renderCategories && (
          <span className="text-xs text-muted" data-testid="render-categories">
            {t("onlyCategories", { list: renderCategories.map((c) => tRoot(`categories.plural.${c}`)).join(", ") })}
          </span>
        )}
      </header>

      {working && (
        <div className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2.5" data-testid="progress">
          <span className="shrink-0 text-sm font-medium">{statusText}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(render.progress * 100)}%` }} />
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
            {message} {render.progress > 0 && `· ${Math.round(render.progress * 100)}%`}
          </span>
          <form action={cancel.bind(null, render.id)}>
            <button className={BUTTON.danger}>{t("cancel")}</button>
          </form>
        </div>
      )}

      {render.status === "error" && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p className="flex-1 text-danger">{formatStored(tRoot, render.error)}</p>
          <RenderAgainButton renderId={render.id} categories={renderCategories} label={t("tryAgain")} />
        </div>
      )}

      {outdated && (
        <div className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
          <span className="flex-1">{t("outdated")}</span>
          <RenderAgainButton renderId={render.id} categories={renderCategories} label={t("renderAgainCurrent")} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-w-0 flex-col bg-viewer lg:min-h-0" aria-label={t("monitor")}>
          {render.status === "ready" ? (
            <video data-final controls preload="metadata" className="min-h-0 w-full flex-1 bg-black" src={`${base}/final_video.mp4?v=${version}`} />
          ) : (
            <div className="grid min-h-64 flex-1 place-items-center text-sm text-white/50">{working ? t("generating") : t("noVideo")}</div>
          )}
        </section>

        <aside className="flex flex-col gap-4 border-line bg-panel px-4 py-3 lg:min-h-0 lg:overflow-y-auto lg:border-l">
          {render.status === "ready" && (
            <section className="flex flex-col gap-2">
              <h2 className={PANEL_TITLE}>{t("download")}</h2>
              <a className={BUTTON.primary} href={`${base}/final_video.mp4?download=${t("fileName")}_${render.id}.mp4`}>
                {t("videoMp4")}
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a className={BUTTON.secondary} href={`${base}/events.csv?download=${t("fileName")}_${render.id}.csv`}>
                  {t("spreadsheet")}
                </a>
                <a className={BUTTON.secondary} href={`${base}/report.json?download=${t("fileName")}_${render.id}.json`}>
                  {t("reportJson")}
                </a>
              </div>
              {!outdated && <RenderAgainButton renderId={render.id} categories={renderCategories} label={t("renderAgain")} />}
            </section>
          )}

          {rep && (
            <section className="flex flex-col gap-2" data-testid="final-totals">
              <h2 className={PANEL_TITLE}>{t("count")}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-faint">
                    <th className="py-1 text-left font-normal" />
                    {lineNames.map((l) => (
                      <th key={l} className="max-w-20 truncate py-1 text-right font-normal" title={l}>
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c}>
                      <td className="py-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 rounded-sm ${LABEL_COLOR[c].bg}`} />
                          {tRoot(`categories.plural.${c}`)}
                        </span>
                      </td>
                      {lineNames.map((l) => {
                        const s = rep.by_direction[l]?.[c] ?? {};
                        return (
                          <td key={l} className="py-0.5 text-right font-mono tabular-nums" title={Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(" · ") || undefined}>
                            {rep.totals[l]?.[c] ?? 0}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className={PANEL_TITLE}>{t("videosInOrder")}</h2>
            <ol className="flex flex-col gap-1 text-sm">
              {jobs.map((j, i) => {
                const v = rep?.videos[i];
                const n = v ? Object.values(v.totals).reduce((a, tot) => a + Object.values(tot).reduce((x, y) => x + (y ?? 0), 0), 0) : null;
                return (
                  <li key={j} className="flex items-center gap-2">
                    <span className="w-4 text-right font-mono text-xs text-faint">{i + 1}</span>
                    <Link href={`/jobs/${j}`} className="min-w-0 flex-1 truncate hover:underline">
                      {getJob(j)?.file_name ?? j}
                    </Link>
                    {v && (
                      <>
                        <JumpTo s={v.start_in_final_s + 2}>{hms(v.start_in_final_s)}</JumpTo>
                        <span className="font-mono text-xs text-faint">{n}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>

      {rep && (
        <section className="shrink-0 border-t border-line bg-panel" aria-label={t("sequence")} data-testid="timeline">
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)]">
            <div className="flex h-8 items-center border-b border-r border-line px-3 text-xs font-medium text-muted">{t("videosTrack")}</div>
            <div className="relative h-8 border-b border-line">
              {rep.videos.map((v, i) => (
                <span
                  key={i}
                  className={`absolute bottom-1 top-1 flex items-center overflow-hidden rounded-sm border-r border-black/40 px-1.5 text-[0.7rem] font-medium text-white ${i % 2 ? "bg-info/70" : "bg-info/50"}`}
                  style={{ left: pct(v.start_in_final_s), width: pct(v.duration_s) }}
                  title={v.title}
                >
                  <span className="truncate">{v.title}</span>
                </span>
              ))}
            </div>
            <div className="flex h-8 items-center border-b border-r border-line px-3 text-xs font-medium text-muted">{t("countsTrack")}</div>
            <div className="relative h-8 border-b border-line bg-raised/50">
              {rep.events.map((e) => (
                <JumpTo
                  key={`${e.video}-${e.candidate}`}
                  s={e.time_in_final_s}
                  mark={LABEL_COLOR[e.category]?.bg}
                  left={pct(e.time_in_final_s)}
                  title={`${catName(e.category)} · ${e.line} ${e.direction} · ${hms(e.time_in_final_s)}`}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {rep && rep.events.length > 0 && (
        <details className="shrink-0 border-t border-line bg-panel px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium">{t("eventList", { n: rep.events.length })}</summary>
          <div className="max-h-72 overflow-y-auto">
            <table className="mt-2 w-full">
              <thead className="text-left text-xs text-faint">
                <tr>
                  <th className="py-1 pr-3 font-normal">{t("col.inFinal")}</th>
                  <th className="py-1 pr-3 font-normal">{t("col.video")}</th>
                  <th className="py-1 pr-3 font-normal">{t("col.line")}</th>
                  <th className="py-1 pr-3 font-normal">{t("col.category")}</th>
                  <th className="py-1 font-normal">{t("col.direction")}</th>
                </tr>
              </thead>
              <tbody>
                {rep.events.map((e) => (
                  <tr key={`${e.video}-${e.candidate}`} className="border-t border-line/60">
                    <td className="py-1 pr-3">
                      <JumpTo s={e.time_in_final_s}>{hms(e.time_in_final_s)}</JumpTo>
                    </td>
                    <td className="py-1 pr-3">
                      {e.video} <span className="font-mono text-xs text-faint">({hms(e.time_in_video_s)})</span>
                    </td>
                    <td className="py-1 pr-3">{e.line}</td>
                    <td className="py-1 pr-3">{catName(e.category)}</td>
                    <td className="py-1">{e.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
