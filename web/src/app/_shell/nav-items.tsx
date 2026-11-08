"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { FIELD } from "@/lib/ui";
import { createGroup } from "./actions";

const ICONS = {
  all: <path d="M2 4.5h12M2 8h12M2 11.5h12" />,
  group: <path d="M1.75 4.25c0-.6.4-1 1-1h3.5l1.5 1.5h5.5c.6 0 1 .4 1 1v6.5c0 .6-.4 1-1 1H2.75c-.6 0-1-.4-1-1Z" />,
  loose: <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />,
  export: <path d="M8 2v8M4.75 6.75 8 10l3.25-3.25M2.5 13.5h11" />,
  project: <path d="M4 1.75h5.5L12.75 5v8.25c0 .55-.45 1-1 1h-7.5c-.55 0-1-.45-1-1V2.75c0-.55.45-1 1-1ZM9.25 1.75V5.25h3.5" />,
  settings: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
};

type Props = {
  href: string;
  /** group the item stands for (null = all; undefined = not a group item) */
  group: string | null | undefined;
  n: number | null;
  icon: keyof typeof ICONS;
  children: React.ReactNode;
};

export function NavItem({ href, group, n, icon, children }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = group === undefined ? pathname.startsWith(href) : pathname === "/" && (params.get("group") ?? null) === group;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
        active ? "bg-raised font-medium text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg"
      }`}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONS[icon]}
      </svg>
      <span className="flex-1 truncate">{children}</span>
      {n !== null && <span className="font-mono text-[0.7rem] tabular-nums text-faint">{n}</span>}
    </Link>
  );
}

export function NewGroup() {
  const t = useTranslations("library");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-faint hover:bg-hover hover:text-fg">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {t("newGroup")}
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-1.5 px-1 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        start(() => createGroup(name));
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={t("groupPlaceholder")}
        aria-label={t("groupNameLabel")}
        className={`${FIELD} w-full`}
        disabled={sending}
      />
      <span className="text-[0.7rem] text-faint">{t("groupHint")}</span>
    </form>
  );
}
