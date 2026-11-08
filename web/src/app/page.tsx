import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { jobWorking } from "@/lib/activity";
import { getGroup, jobDir, listCandidates, listGroups, listJobs, readSetting, reviewSummary } from "@/lib/db";
import { statusKey } from "@/lib/status";
import { BUTTON } from "@/lib/ui";
import { GroupHeader } from "./group-header";
import { VideoGrid, type GridVideo } from "./video-grid";
import { AutoRefresh } from "./jobs/[id]/auto-refresh";
import { PageLoading } from "@/app/_shell/page-loading";

export default function Home(props: PageProps<"/">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Dashboard searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  // first run: the wizard sets up the graphics card, the engine and the AI key
  if (!readSetting("first_run")) redirect("/welcome");
  const t = await getTranslations();
  const locale = await getLocale();
  const sp = await searchParams;
  const filter = typeof sp.group === "string" ? sp.group : null;
  const group = filter && filter !== "none" ? getGroup(filter) : undefined;
  const groups = listGroups();

  const jobs = listJobs()
    .filter((j) => (filter === "none" ? !j.group_id : group ? j.group_id === group.id : true))
    .sort((a, b) => (a.file_name ?? a.drive_id).localeCompare(b.file_name ?? b.drive_id, locale, { numeric: true }));

  const videos: GridVideo[] = jobs.map((j) => {
    const r = reviewSummary(j.id);
    const inReview = j.status === "awaiting_review";
    return {
      id: j.id,
      name: j.file_name ?? j.drive_id,
      local: j.drive_id === "local",
      group: groups.find((g) => g.id === j.group_id)?.name ?? null,
      status: j.status,
      statusKey: statusKey(j),
      working: jobWorking(j),
      progress: j.progress,
      message: j.message,
      error: j.status === "error" ? j.error : null,
      duration_s: j.duration_s,
      thumbnail: fs.existsSync(path.join(jobDir(j.id), "frame0.jpg")) ? `/api/jobs/${j.id}/files/frame0.jpg` : null,
      reviewed: r.reviewed,
      total: r.total,
      counts: inReview ? listCandidates(j.id).filter((c) => c.label && c.label !== "discarded").length : 0,
      // why it cannot go into a final video yet (null = it can)
      blocker: !inReview
        ? { key: j.status === "suggesting" ? "waitingSuggestions" : "reviewNotStarted" }
        : r.reviewed < r.total
          ? { key: "remaining", values: { n: r.total - r.reviewed } }
          : null,
    };
  });

  const title = group?.name ?? (filter === "none" ? t("library.ungrouped") : t("library.allVideos"));

  return (
    <div className="flex flex-col gap-4 p-5">
      {videos.some((v) => v.working) && <AutoRefresh ms={2000} />}
      <GroupHeader group={group ?? null} title={title} videos={videos.length} />

      {videos.length === 0 ? (
        <Empty inGroup={!!filter} />
      ) : (
        <VideoGrid key={filter ?? ""} videos={videos} groups={groups.map((g) => ({ id: g.id, name: g.name }))} currentGroup={group?.id ?? null} />
      )}
    </div>
  );
}

async function Empty({ inGroup }: { inGroup: boolean }) {
  const t = await getTranslations("home");
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-16 text-center">
      <p className="text-lg font-medium">{inGroup ? t("emptyGroup") : t("emptyLibrary")}</p>
      <p className="max-w-md text-sm text-muted">{inGroup ? t("emptyGroupHint") : t("emptyLibraryHint")}</p>
      <Link href="/import" className={BUTTON.primary}>
        {t("importVideos")}
      </Link>
    </div>
  );
}
