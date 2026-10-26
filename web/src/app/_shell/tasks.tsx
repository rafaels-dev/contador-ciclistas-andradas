import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatStored } from "@/i18n/message";
import type { Task } from "@/lib/activity";
import { PANEL_TITLE } from "@/lib/ui";

/** Side bar panel: everything running, with progress; clicking opens the video. */
export async function TasksPanel({ tasks }: { tasks: Task[] }) {
  const t = await getTranslations();
  const running = tasks.filter((x) => !x.queued).length;
  return (
    <section className="flex min-h-0 flex-col gap-1" aria-label={t("tasks.title")} data-testid="tasks">
      <h2 className={`${PANEL_TITLE} flex items-center gap-2 px-2 pb-1`}>
        {t("tasks.title")}
        {tasks.length > 0 && (
          <span className="rounded bg-accent px-1 font-mono text-[0.65rem] font-semibold text-accent-ink">{tasks.length}</span>
        )}
      </h2>
      {tasks.length === 0 ? (
        <p className="px-2 text-xs text-faint">{t("tasks.nothingNow")}</p>
      ) : (
        <>
          {tasks.length > running && (
            <p className="px-2 text-[0.7rem] text-faint">{t("tasks.runningQueued", { running, queued: tasks.length - running })}</p>
          )}
          <ul className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto">
            {tasks.map((task) => {
              const message = task.message ? formatStored(t, task.message) : null;
              return (
                <li key={task.key}>
                  <Link href={task.href} className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-hover" title={message ?? undefined}>
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${task.queued ? "bg-faint" : "animate-pulse bg-accent"}`} aria-hidden />
                      <span className="truncate text-xs font-medium">{task.name === "engine" ? t("tasks.engine") : task.name}</span>
                    </span>
                    <span className="flex items-center gap-2 pl-3 text-[0.7rem] text-muted">
                      <span className="truncate">{t(task.stage.key, task.stage.values)}</span>
                      {task.progress !== null && task.progress > 0 && <span className="ml-auto shrink-0 font-mono tabular-nums">{Math.round(task.progress * 100)}%</span>}
                    </span>
                    {!task.queued && (
                      <span className={`ml-3 h-1 overflow-hidden rounded-full bg-line ${task.progress === null ? "indeterminate-bar" : ""}`}>
                        {task.progress !== null && <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(task.progress * 100)}%` }} />}
                      </span>
                    )}
                    {message && !task.queued && <span className="truncate pl-3 font-mono text-[0.65rem] text-faint">{message}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
