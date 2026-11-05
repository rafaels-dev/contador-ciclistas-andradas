import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ThemeButton } from "./theme-button";

/**
 * The app title bar. On the desktop (Electron, frameless window) it is the
 * window drag region and leaves room for the system buttons: traffic lights
 * on the left on macOS, minimize/close on the right on Windows/Linux.
 */
export async function TitleBar() {
  const t = await getTranslations("app");
  return (
    <header className="drag-region flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 title-bar">
      <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-0.5">
        <Logo />
        <span className="font-display text-[0.95rem] font-semibold tracking-wide">{t("name")}</span>
      </Link>
      <span className="flex-1" />
      <ThemeButton />
    </header>
  );
}

/** A yellow counting line crossing the lane — the app's central gesture. */
export function Logo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5" className="fill-raised stroke-line" strokeWidth="1.5" />
      <path d="M5 16.5h14M5 7.5h14" className="stroke-faint" strokeWidth="1.5" strokeDasharray="2.5 2" />
      <path d="M15.5 3.5 8.5 20.5" className="stroke-accent" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
