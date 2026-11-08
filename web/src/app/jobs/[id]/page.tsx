import fs from "node:fs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { formatStored, parseMessage } from "@/i18n/message";
import { jobFile, listCameras, listCandidates, getGroup, getJob, suggestionSummary, type Area, type Job, type Line } from "@/lib/db";
import { detectionPreview, hasTracks, mediaRebuildFailure, mediaRebuilding, suggestionsRunning, videoPath } from "@/lib/runner";
import { STEPS, currentStep, statusKey } from "@/lib/status";
import { BUTTON, timecode } from "@/lib/ui";
import { cancel, resumeSuggestions, reviewWithoutSuggestions, retryJob } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { EditLinesButton } from "./edit-lines-button";
import { FilesNotice } from "./files-notice";
import { LineCategories } from "./line-categories";
import { LineEditor } from "./line-editor";
import { Review } from "./review";
import { PageLoading } from "@/app/_shell/page-loading";

export default function JobPage(props: PageProps<"/jobs/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <JobDetail params={props.params} />
    </Suspense>
  );
}

/** Import → Lines → Detection → Suggestions → Review, with the current step highlighted. */
async function Steps({ job }: { job: Job }) {
  const t = await getTranslations();
  const current = currentStep(job.status);
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label={t("job.stepsLabel")}>
      {STEPS.map((step, i) => {
        const state = current < 0 ? "future" : i < current ? "done" : i === current ? "current" : "future";
        return (
          <li key={step} className="flex items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span className={`h-px w-4 ${state === "future" ? "bg-line" : "bg-faint"}`} />}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                state === "current" ? "bg-accent font-semibold text-accent-ink" : state === "done" ? "text-muted" : "text-faint"
              }`}
            >
              <span className="font-mono">{state === "done" ? "✓" : i + 1}</span>
              {t(`steps.${step}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Suggestions stopped: some candidates got no answer from the AI. The user
 * can try again or review anyway (the ones without a suggestion are
 * classified by hand). "Save diagnostics" creates the file for support.
 */
async function PendingSuggestionsBar({ job }: { job: Job }) {
  const t = await getTranslations("job");
  const r = suggestionSummary(job.id);
  const unanswered = r.total - r.ok;
  const onlyFailures = r.ok + r.failed >= r.total;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn" data-testid="pending-suggestions">
      <span className="flex-1">
        {onlyFailures ? t("suggestionsFailed", { n: unanswered, total: r.total }) : t("suggestionsPending", { n: unanswered, total: r.total })}
      </span>
      <form action={resumeSuggestions.bind(null, job.id)}>
        <button className={onlyFailures ? BUTTON.secondary : BUTTON.primary}>{t("tryAgain")}</button>
      </form>
      {onlyFailures && (
        <form action={reviewWithoutSuggestions.bind(null, job.id)}>
          <button className={BUTTON.primary}>{t("reviewAnyway")}</button>
        </form>
      )}
      <a href="/api/diagnostics" className={BUTTON.ghost} title={t("saveDiagnosticsHint")}>
        {t("saveDiagnostics")}
      </a>
    </div>
  );
}

async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();
  const t = await getTranslations();
  const base = `/api/jobs/${job.id}/files`;
  const suggestingNow = job.status === "suggesting" && suggestionsRunning(job.id);
  const working = job.status === "downloading" || job.status === "detecting" || suggestingNow;
  const lines = JSON.parse(job.lines) as Line[];
  const group = job.group_id ? getGroup(job.group_id) : undefined;
  const inReview = ["suggesting", "awaiting_review", "rendering", "done"].includes(job.status);
  const name = job.file_name ?? job.drive_id;
  // errors.ai.*: a problem with the AI key — fixed in Settings
  const keyProblem = parseMessage(job.error)?.$t.startsWith("errors.ai.") ?? false;

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {working && <AutoRefresh />}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label={t("job.breadcrumb")}>
          <Link href={group ? `/?group=${group.id}` : "/"} className="shrink-0 text-muted hover:text-fg">
            {group?.name ?? t("library.title")}
          </Link>
          <span className="text-faint">/</span>
          <h1 className="truncate font-semibold" title={name}>
            {name}
          </h1>
        </nav>
        <span className="font-mono text-[0.7rem] text-faint">
          {job.duration_s ? timecode(job.duration_s, true) : ""}
          {job.width ? ` · ${job.width}×${job.height} · ${job.fps?.toFixed(0)} fps` : ""}
        </span>
        <span className="flex-1" />
        <Steps job={job} />
        {(job.status === "suggesting" || job.status === "awaiting_review") && !suggestingNow && <EditLinesButton jobId={job.id} quick={hasTracks(job.id)} />}
      </header>

      {working && (
        <div className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2.5" data-testid="progress">
          <span className="shrink-0 text-sm font-medium">{t(statusKey(job))}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
            {formatStored(t, job.message)} {job.progress > 0 && `· ${Math.round(job.progress * 100)}%`}
          </span>
          {!suggestingNow && (
            <form action={cancel.bind(null, job.id)}>
              <button className={BUTTON.danger}>{t("job.cancel")}</button>
            </form>
          )}
        </div>
      )}

      {job.status === "error" && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p className="flex-1 text-danger">{formatStored(t, job.error)}</p>
          {keyProblem && (
            <Link href="/settings" className={BUTTON.primary}>
              {t("job.openSettings")}
            </Link>
          )}
          <form action={retryJob.bind(null, job.id)}>
            <button className={BUTTON.secondary}>{t("job.retry")}</button>
          </form>
          <a href="/api/diagnostics" className={BUTTON.ghost} title={t("job.saveDiagnosticsHint")}>
            {t("job.saveDiagnostics")}
          </a>
        </div>
      )}

      {(job.status === "downloading" || job.status === "detecting") && job.width && (
        <DetectionPreview base={base} version={job.status === "detecting" ? detectionPreview(job.id) : null} />
      )}

      {job.status === "awaiting_lines" && job.width && job.height && (
        <LineEditor
          jobId={job.id}
          frameUrl={`${base}/frame0.jpg`}
          width={job.width}
          height={job.height}
          initialLines={lines}
          initialArea={job.area ? (JSON.parse(job.area) as Area) : null}
          cameras={listCameras().map((c) => ({ id: c.id, name: c.name, lines: JSON.parse(c.lines) as Line[], area: c.area ? (JSON.parse(c.area) as Area) : null }))}
          initialCamera={job.camera_id}
          pointsUrl={hasTracks(job.id) ? `${base}/points.json` : null}
        />
      )}

      {inReview && <DeletedFiles job={job} />}

      {inReview && (
        <>
          {job.status === "suggesting" && !suggestingNow && <PendingSuggestionsBar job={job} />}
          <Review
            key={job.status}
            jobId={job.id}
            base={base}
            candidates={listCandidates(job.id)}
            lines={lines}
            duration={job.duration_s ?? 0}
            fps={job.fps ?? 15}
            width={job.width ?? 1920}
            height={job.height ?? 1080}
            videoUrl={`/api/jobs/${job.id}/video`}
            area={job.area ? (JSON.parse(job.area) as Area) : null}
            editable={job.status === "awaiting_review"}
            linesPanel={(job.status === "suggesting" || job.status === "awaiting_review") && <LineCategories jobId={job.id} lines={lines} />}
          />
        </>
      )}
    </div>
  );
}

/**
 * During detection, the frame the worker is analyzing (with the boxes and the
 * lines), swapped on each page refresh — a single file that the worker
 * overwrites. Before the first one, the video's first frame, dimmed.
 */
async function DetectionPreview({ base, version }: { base: string; version: number | null }) {
  const t = await getTranslations("job");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-viewer p-6">
      {version ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${base}/preview.jpg?v=${Math.round(version)}`} alt={t("previewAlt")} className="min-h-0 max-w-full flex-1 object-contain" />
          <p className="text-xs text-muted">{t("previewCaption")}</p>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${base}/frame0.jpg`} alt={t("firstFrameAlt")} className="max-h-full max-w-full opacity-60" />
      )}
    </div>
  );
}

/**
 * Files missing: review images (deleted to free space, cleaned by the system
 * from the temporary folder, or a project opened on another computer), the
 * Drive copy, or the original video that moved. The decisions are in the
 * database: the images are made again from the trajectories.
 */
async function DeletedFiles({ job }: { job: Job }) {
  const media = listCandidates(job.id).find((c) => c.filmstrip && c.origin !== "manual");
  const mediaGone = !!media?.filmstrip && !fs.existsSync(jobFile(job.id, media.filmstrip));
  const video = videoPath(job.id);
  const videoHere = fs.existsSync(video);
  const driveGone = job.drive_id !== "local" && !videoHere;
  const localGone = job.drive_id === "local" && !videoHere;
  const progress = mediaRebuilding(job.id);
  const failure = mediaRebuildFailure(job.id);
  if (!mediaGone && !driveGone && !localGone && progress === null) return null;
  return (
    <>
      {progress !== null && <AutoRefresh />}
      <FilesNotice
        jobId={job.id}
        mediaGone={mediaGone}
        driveGone={driveGone}
        localGone={localGone ? video : null}
        canRebuild={hasTracks(job.id) && videoHere}
        progress={progress}
        failure={failure}
      />
    </>
  );
}
