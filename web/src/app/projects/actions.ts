"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { getGroup } from "@/lib/db";
import { ProjectProblem, defaultProjectFile, listProjects, openProject, saveProject, type ProjectEntry, type ProjectError } from "@/lib/project";

export type SaveResult = { file?: string; savedAt?: string | null; error?: ProjectError };

/** Saves a group as a project file: its current file, or `file` ("Save as…"). */
export async function saveGroupProject(groupId: string, file?: string | null): Promise<SaveResult> {
  await requireAccess();
  try {
    const saved = saveProject(String(groupId), file ? String(file) : undefined);
    refresh();
    return { file: saved, savedAt: getGroup(String(groupId))?.project_saved_at ?? null };
  } catch (e) {
    if (e instanceof ProjectProblem) return { error: e.reason };
    console.error(`[project] save ${groupId}: ${e instanceof Error ? e.stack : e}`);
    return { error: "notWritable" };
  }
}

/** Where "Save as…" proposes to save (the desktop dialog starts there). */
export async function proposedProjectFile(groupId: string): Promise<string | null> {
  await requireAccess();
  const g = getGroup(String(groupId));
  return g ? (g.project_file ?? defaultProjectFile(g.name, g.id)) : null;
}

export async function projectList(): Promise<ProjectEntry[]> {
  await requireAccess();
  return listProjects();
}

/** Opens a project file as a library group and goes to it. */
export async function openProjectFile(file: string): Promise<{ error: ProjectError } | void> {
  await requireAccess();
  let groupId: string;
  try {
    groupId = openProject(String(file)).groupId;
  } catch (e) {
    if (e instanceof ProjectProblem) return { error: e.reason };
    console.error(`[project] open ${file}: ${e instanceof Error ? e.stack : e}`);
    return { error: "invalid" };
  }
  refresh();
  redirect(`/?group=${groupId}`);
}
