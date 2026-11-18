"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Locale, Messages } from "@/lib/site";
import { Shot, type ShotName } from "./Shot";

const SHOTS: ShotName[] = ["library", "lines", "detect", "byHand", "final"];

/**
 * The route: five stops joined edge to edge. With scripting on they are tabs
 * that switch the screen below; without it every stop shows, in order.
 */
export function Route({ locale, t }: { locale: Locale; t: Messages["route"] }) {
  const [scripted, setScripted] = useState(false);
  const [current, setCurrent] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => setScripted(true), []);

  function onKeyDown(e: KeyboardEvent) {
    const last = t.stops.length - 1;
    const next =
      e.key === "ArrowRight" ? (current === last ? 0 : current + 1)
      : e.key === "ArrowLeft" ? (current === 0 ? last : current - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setCurrent(next);
    tabs.current[next]?.focus({ preventScroll: true });
  }

  return (
    <div>
      {scripted && (
        <div className="stops" role="tablist" aria-label={t.tablist} onKeyDown={onKeyDown}>
          {t.stops.map((stop, i) => (
            <button
              key={stop.name}
              ref={(el) => { tabs.current[i] = el; }}
              className="stop"
              type="button"
              role="tab"
              id={`stop-${i}`}
              aria-selected={i === current}
              aria-controls={`panel-${i}`}
              tabIndex={i === current ? 0 : -1}
              onClick={() => setCurrent(i)}
            >
              <b aria-hidden="true">{i + 1}</b>
              {stop.name}
            </button>
          ))}
        </div>
      )}
      <div className="panels">
        {t.stops.map((stop, i) => (
          <section
            key={stop.name}
            className="panel"
            id={`panel-${i}`}
            role={scripted ? "tabpanel" : undefined}
            aria-labelledby={scripted ? `stop-${i}` : undefined}
            hidden={scripted && i !== current}
          >
            <div className="panel__text">
              <h3>{stop.title}</h3>
              <p>{stop.text}</p>
            </div>
            <Shot locale={locale} name={SHOTS[i]} slot={`stop-${i + 1}`} alt={stop.alt} />
          </section>
        ))}
      </div>
    </div>
  );
}
