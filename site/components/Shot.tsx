import type { Locale } from "@/lib/site";

/**
 * Real captures of the app (site/public/shots). Screens and final-video frames
 * exist once per language, in `shots/<locale in lowercase>/`; the strip of
 * crops has no text and is shared. Sizes are the files' own pixels.
 */
const SHOTS = {
  review: { file: "review.webp", width: 2880, height: 1800, kind: "", shared: false },
  library: { file: "library.webp", width: 2880, height: 1800, kind: "", shared: false },
  lines: { file: "lines.webp", width: 2880, height: 1800, kind: "", shared: false },
  detect: { file: "candidate-1.jpg", width: 742, height: 160, kind: "shot--strip", shared: true },
  byHand: { file: "review-video.webp", width: 2880, height: 1800, kind: "", shared: false },
  final: { file: "final-frame-1.jpg", width: 1920, height: 1080, kind: "shot--video", shared: false },
  finalClose: { file: "final-frame-3.jpg", width: 1920, height: 1080, kind: "shot--video", shared: false },
} as const;

export type ShotName = keyof typeof SHOTS;

/**
 * One capture in the theme's frame. The slot lets the picture be swapped
 * (`hallmarkSlots`) without touching the layout; a caption goes outside it.
 */
export function Shot({
  locale,
  name,
  slot,
  alt,
  caption,
  lead = false,
}: {
  locale: Locale;
  name: ShotName;
  slot: string;
  alt: string;
  caption?: string;
  lead?: boolean;
}) {
  const shot = SHOTS[name];
  const src = shot.shared ? `/shots/${shot.file}` : `/shots/${locale.toLowerCase()}/${shot.file}`;
  return (
    <figure className="frame">
      <div className={`shot ${shot.kind}`} data-slot={slot} data-kind="product" data-alt={alt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          width={shot.width}
          height={shot.height}
          alt={alt}
          {...(lead ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
        />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
