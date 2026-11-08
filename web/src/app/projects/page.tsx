import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { listProjects } from "@/lib/project";
import { projectsFolder } from "@/lib/storage";
import { PageLoading } from "@/app/_shell/page-loading";
import { OpenProject } from "./open-project";

/** Projects: the project files in the Projects folder, and opening any other one. */
export default function ProjectsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const t = await getTranslations("project");
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5">
      <h1 className="font-display text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted">{t("intro")}</p>
      <OpenProject projects={listProjects()} folder={projectsFolder()} />
    </div>
  );
}
