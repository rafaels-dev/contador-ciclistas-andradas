"use client";

import { useEffect, useState } from "react";
import { PLATFORMS, type PlatformId, type Release, detectPlatforms, latestRelease } from "@/lib/release";
import type { Locale, Messages } from "@/lib/site";

/**
 * The download page's body. Without scripting it is the table of every
 * installer; with it, the visitor's own system is offered first, and the list
 * is refreshed from the latest release.
 */
export function Download({ locale, t, initial }: { locale: Locale; t: Messages["download"]; initial: Release }) {
  const [release, setRelease] = useState(initial);
  const [detected, setDetected] = useState<PlatformId[]>([]);

  useEffect(() => {
    setDetected(detectPlatforms(navigator.userAgent, navigator.platform ?? ""));
    let live = true;
    latestRelease().then((latest) => {
      if (live && latest.version !== initial.version) setRelease(latest);
    });
    return () => { live = false; };
  }, [initial.version]);

  const megabytes = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const size = (bytes: number) => `${megabytes.format(bytes / 1048576)} MB`;
  const asset = (id: PlatformId) => release.assets.find((a) => a.id === id);
  const date = release.date
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${release.date}T00:00:00Z`))
    : "";

  return (
    <>
      <div className="plate on-ink get">
        {detected.length === 0 ? (
          <a className="btn btn--primary" href="#all">{t.choose}</a>
        ) : (
          detected.map((id, i) => (
            <a key={id} className={i === 0 ? "btn btn--primary" : "btn"} href={asset(id)?.url} download>
              {t.detected.replace("{platform}", t.platforms[id])}
            </a>
          ))
        )}
        <p className="small">{t.version.replace("{version}", release.version).replace("{date}", date)}</p>
      </div>

      <table className="list" id="all">
        <caption>{t.all}</caption>
        <thead>
          <tr>
            <th scope="col">{t.cols.system}</th>
            <th scope="col">{t.cols.file}</th>
            <th scope="col" className="num">{t.cols.size}</th>
            <th scope="col"><span className="visually-hidden">{t.get}</span></th>
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map((id) => (
            <tr key={id}>
              <td className="what">{t.platforms[id]}</td>
              <td>{t.files[id]}</td>
              <td className="num">{size(asset(id)?.size ?? 0)}</td>
              <td className="act">
                <a href={asset(id)?.url} download aria-label={`${t.get}: ${t.platforms[id]}`}>{t.get}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
