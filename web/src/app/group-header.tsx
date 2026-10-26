"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { Group } from "@/lib/db";
import { BUTTON, FIELD } from "@/lib/ui";
import { removeGroup, renameGroup } from "./_shell/actions";

export function GroupHeader({ group, title, videos }: { group: Group | null; title: string; videos: number }) {
  const t = useTranslations("group");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [, start] = useTransition();

  return (
    <header className="flex flex-wrap items-center gap-3">
      {editing && group ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            start(() => renameGroup(group.id, name));
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} className={`${FIELD} text-lg font-semibold`} aria-label={t("nameLabel")} />
          <button className={BUTTON.secondary}>{t("save")}</button>
        </form>
      ) : (
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
      )}
      <span className="font-mono text-xs text-faint">{t("videos", { n: videos })}</span>
      <span className="flex-1" />
      {group && !editing && (
        <>
          <button type="button" onClick={() => (setName(group.name), setEditing(true))} className={BUTTON.ghost}>
            {t("rename")}
          </button>
          <button
            type="button"
            onClick={() => confirm(t("confirmDelete", { name: group.name })) && start(() => removeGroup(group.id))}
            className={BUTTON.danger}
          >
            {t("delete")}
          </button>
        </>
      )}
      {group && (
        <Link href={`/import?group=${group.id}`} className={BUTTON.secondary}>
          {t("importHere")}
        </Link>
      )}
    </header>
  );
}
