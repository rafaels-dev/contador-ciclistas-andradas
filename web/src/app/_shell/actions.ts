"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { deleteGroup, getGroup, moveJobs, saveGroup } from "@/lib/db";

function validName(name: unknown): string | null {
  const n = String(name ?? "").trim().slice(0, 80);
  return n || null;
}

export async function createGroup(name: string): Promise<void> {
  const n = validName(name);
  if (!n) return;
  const id = randomUUID().slice(0, 8);
  saveGroup(id, n);
  // redirect alone only changes the page: the side library (layout) kept
  // the old list, without the new group (Next 16.4, production build)
  refresh();
  redirect(`/?group=${id}`);
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const n = validName(name);
  if (!n || !getGroup(id)) return;
  saveGroup(id, n);
  refresh();
}

export async function removeGroup(id: string): Promise<void> {
  deleteGroup(String(id));
  refresh();
  redirect("/?group=none");
}

/** groupId null = take out of the group. */
export async function moveToGroup(ids: string[], groupId: string | null): Promise<void> {
  if (groupId && !getGroup(groupId)) return;
  moveJobs(ids.map(String).filter((id) => /^[\w-]{1,40}$/.test(id)), groupId);
  refresh();
}
