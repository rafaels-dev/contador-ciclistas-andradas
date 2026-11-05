import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { tasksInProgress } from "@/lib/activity";
import { AutoRefresh } from "../jobs/[id]/auto-refresh";

/** Footer with the main task in progress (the full list is in the side bar). */
export async function StatusBar() {
  await connection();
  const t = await getTranslations();
  const tasks = tasksInProgress();
  const main = tasks[0];
  const p = main?.progress ?? 0;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-xs text-muted" data-testid="status-bar">
      {tasks.length > 0 && <AutoRefresh ms={3000} />}
      {main ? (
        <>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          <Link href={main.href} className="flex min-w-0 items-center gap-2 hover:text-fg">
            <span className="shrink-0">{t(main.stage.key, main.stage.values)}</span>
            <span className="truncate text-fg">{main.name === "engine" ? t("tasks.engine") : main.name}</span>
            {main.progress !== null && (
              <>
                <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-line">
                  <span className="block h-full bg-accent" style={{ width: `${Math.round(p * 100)}%` }} />
                </span>
                <span className="font-mono tabular-nums">{Math.round(p * 100)}%</span>
              </>
            )}
          </Link>
          {tasks.length > 1 && <span className="shrink-0">{t("tasks.more", { n: tasks.length - 1 })}</span>}
        </>
      ) : (
        <span>{t("tasks.nothing")}</span>
      )}
    </footer>
  );
}
