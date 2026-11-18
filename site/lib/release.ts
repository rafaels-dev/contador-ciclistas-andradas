import { REPO } from "./site";

/** One installer per row of the download page, in the order shown. */
export const PLATFORMS = ["windows", "macArm", "macIntel", "appimage", "deb"] as const;
export type PlatformId = (typeof PLATFORMS)[number];

export type Asset = { id: PlatformId; url: string; size: number };
export type Release = { version: string; date: string; assets: Asset[] };

/** Which release file is which installer (names come from electron-builder). */
const PATTERNS: Record<PlatformId, RegExp> = {
  windows: /Setup.*\.exe$/,
  macArm: /arm64\.dmg$/,
  macIntel: /x64\.dmg$/,
  appimage: /\.AppImage$/,
  deb: /\.deb$/,
};

const API = `${REPO.replace("https://github.com/", "https://api.github.com/repos/")}/releases/latest`;

/** The release known when this was written; used when GitHub cannot be reached. */
const FALLBACK: Release = {
  version: "0.0.12",
  date: "2026-11-18",
  assets: (
    [
      ["windows", "counter-bike-Setup-0.0.12.exe", 151556501],
      ["macArm", "counter-bike-0.0.12-arm64.dmg", 171445850],
      ["macIntel", "counter-bike-0.0.12-x64.dmg", 178298967],
      ["appimage", "counter-bike-0.0.12-x86_64.AppImage", 180983126],
      ["deb", "counter-bike-0.0.12-amd64.deb", 145495836],
    ] as const
  ).map(([id, name, size]) => ({ id, url: `${REPO}/releases/download/v0.0.12/${name}`, size })),
};

type GitHubRelease = {
  tag_name?: string;
  published_at?: string;
  assets?: { name: string; browser_download_url: string; size: number }[];
};

/** Reads GitHub's answer; undefined when it does not hold every installer. */
function fromGitHub(json: GitHubRelease): Release | undefined {
  if (!json.tag_name || !json.assets) return undefined;
  const assets: Asset[] = [];
  for (const id of PLATFORMS) {
    const file = json.assets.find((a) => PATTERNS[id].test(a.name));
    if (!file) return undefined;
    assets.push({ id, url: file.browser_download_url, size: file.size });
  }
  return { version: json.tag_name.replace(/^v/, ""), date: (json.published_at ?? "").slice(0, 10), assets };
}

/**
 * The latest release: asked at build time and again in the visitor's browser,
 * so the page keeps offering the newest installers between two builds of the site.
 * The links are the files themselves, so a click downloads without opening GitHub.
 */
export async function latestRelease(): Promise<Release> {
  try {
    const answer = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
    if (!answer.ok) return FALLBACK;
    return fromGitHub((await answer.json()) as GitHubRelease) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** The installers to offer first for the visitor's system; empty when unknown. */
export function detectPlatforms(userAgent: string, platform: string): PlatformId[] {
  const text = `${platform} ${userAgent}`.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(text)) return [];
  if (text.includes("win")) return ["windows"];
  if (text.includes("mac")) return ["macArm", "macIntel"];
  if (/linux|x11|cros/.test(text)) return ["appimage", "deb"];
  return [];
}
