"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { formatStored } from "@/i18n/message";
import { BUTTON, FIELD } from "@/lib/ui";
import { browseFolder, createLocalJobs, type FolderState } from "./actions";

const LAST_FOLDER_KEY = "tc:lastFolder";

function size(bytes: number, locale: string): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })} GB` : `${Math.round(bytes / 1e6).toLocaleString(locale)} MB`;
}

const FOLDER_ICON = <path d="M1.75 4.25c0-.6.4-1 1-1h3.5l1.5 1.5h5.5c.6 0 1 .4 1 1v6.5c0 .6-.4 1-1 1H2.75c-.6 0-1-.4-1-1Z" />;
const VIDEO_ICON = (
  <>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="m6.75 6 3 2-3 2Z" />
  </>
);

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** Picks videos that are already on the computer — the app reads them in place, no copy. */
export function LocalPicker({ group }: { group: string }) {
  const t = useTranslations("localPicker");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [state, setState] = useState<FolderState | null>(null);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, start] = useTransition();
  // desktop app: native file dialog (only exists after hydration)
  const native = useSyncExternalStore(
    () => () => {},
    () => !!window.trafficCounterDesktop?.pickVideos,
    () => false,
  );

  function open(dirPath: string | null) {
    start(async () => {
      const next = await browseFolder(dirPath);
      setState(next);
      if (next.content) {
        setTyped(next.content.path);
        setChecked(next.selected ? [next.selected] : []);
        try {
          localStorage.setItem(LAST_FOLDER_KEY, next.content.path);
        } catch {}
      }
    });
  }

  // opens in the last folder used (or the user folder)
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_FOLDER_KEY);
    } catch {}
    open(last);
  }, []);

  const c = state?.content;
  return (
    <div className="flex flex-col gap-3" data-testid="local-picker">
      {native && (
        <button
          type="button"
          disabled={busy}
          className={`${BUTTON.primary} self-start`}
          onClick={async () => {
            const paths = (await window.trafficCounterDesktop?.pickVideos?.()) ?? [];
            if (paths.length) start(() => createLocalJobs(paths, group || null));
          }}
        >
          {t("pickVideos")}
        </button>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          open(typed);
        }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={t("pathLabel")}
          placeholder={t("pathPlaceholder")}
          className={`${FIELD} min-w-0 flex-1 font-mono text-xs`}
        />
        <button className={BUTTON.secondary}>{t("go")}</button>
      </form>

      {state && state.roots.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {state.roots.map((r) => (
            <button key={r.path} type="button" onClick={() => open(r.path)} title={r.path} className="rounded border border-line bg-raised px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg">
              {r.home ? t("home") : r.name}
            </button>
          ))}
        </div>
      )}

      {state?.error && <p className="text-sm text-danger">{formatStored(tRoot, state.error)}</p>}

      <ul className={`h-72 overflow-y-auto rounded-md border border-line bg-raised text-sm ${busy ? "opacity-50" : ""}`}>
        {!state && <li className="px-3 py-1.5 text-faint">{t("opening")}</li>}
        {c?.parent && (
          <li>
            <button type="button" onClick={() => open(c.parent)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:bg-hover">
              <Icon>
                <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
              </Icon>
              {t("up")}
            </button>
          </li>
        )}
        {c?.folders.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => open(f.path)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover">
              <Icon>{FOLDER_ICON}</Icon>
              <span className="truncate">{f.name}</span>
            </button>
          </li>
        ))}
        {c?.videos.map((v) => (
          <li key={v.path}>
            <label className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-hover ${checked.includes(v.path) ? "bg-accent/10" : ""}`}>
              <input
                type="checkbox"
                checked={checked.includes(v.path)}
                onChange={(e) => setChecked((m) => (e.target.checked ? [...m, v.path] : m.filter((x) => x !== v.path)))}
                className="accent-[var(--accent)]"
              />
              <Icon>{VIDEO_ICON}</Icon>
              <span className="flex-1 truncate">{v.name}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{size(v.bytes ?? 0, locale)}</span>
            </label>
          </li>
        ))}
        {c && !c.folders.length && !c.videos.length && <li className="px-3 py-1.5 text-faint">{t("empty")}</li>}
      </ul>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!checked.length || busy} onClick={() => start(() => createLocalJobs(checked, group || null))} className={BUTTON.primary}>
          {t("importN", { n: checked.length })}
        </button>
        {c && c.videos.length > 1 && (
          <button type="button" onClick={() => setChecked(checked.length === c.videos.length ? [] : c.videos.map((v) => v.path))} className={BUTTON.ghost}>
            {checked.length === c.videos.length ? t("uncheckAll") : t("checkAll")}
          </button>
        )}
      </div>
    </div>
  );
}
