import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { tasksInProgress } from "@/lib/activity";
import { listGroups, listJobs, listRenders } from "@/lib/db";
import { BUTTON, PANEL_TITLE } from "@/lib/ui";
import { NavItem, NewGroup } from "./nav-items";
import { TasksPanel } from "./tasks";

/** Side panel: the video library, organized in groups, and the exports. */
export async function Library() {
  await connection();
  const t = await getTranslations("library");
  const jobs = listJobs();
  const groups = listGroups();
  const ungrouped = jobs.filter((j) => !j.group_id).length;
  const renders = listRenders().length;

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel px-2 py-3" aria-label={t("title")}>
      <Link href="/import" className={`${BUTTON.primary} mx-1`}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {t("import")}
      </Link>

      <nav className="flex flex-col gap-0.5">
        <h2 className={`${PANEL_TITLE} px-2 pb-1`}>{t("title")}</h2>
        <NavItem href="/" group={null} n={jobs.length} icon="all">
          {t("allVideos")}
        </NavItem>
        {groups.map((g) => (
          <NavItem key={g.id} href={`/?group=${g.id}`} group={g.id} n={g.n} icon="group">
            {g.name}
          </NavItem>
        ))}
        {ungrouped > 0 && groups.length > 0 && (
          <NavItem href="/?group=none" group="none" n={ungrouped} icon="loose">
            {t("ungrouped")}
          </NavItem>
        )}
        <NewGroup />
        <NavItem href="/projects" group={undefined} n={null} icon="project">
          {t("projects")}
        </NavItem>
      </nav>

      <nav className="flex flex-col gap-0.5">
        <h2 className={`${PANEL_TITLE} px-2 pb-1`}>{t("finalVideo")}</h2>
        <NavItem href="/renders" group={undefined} n={renders} icon="export">
          {t("exports")}
        </NavItem>
      </nav>

      <TasksPanel tasks={tasksInProgress()} />

      <nav className="mt-auto flex flex-col gap-0.5">
        <NavItem href="/settings" group={undefined} n={null} icon="settings">
          {t("settings")}
        </NavItem>
      </nav>
    </aside>
  );
}
