import { timingSafeEqual } from "node:crypto";

/**
 * Access to the server embedded in the desktop app. It listens on
 * 127.0.0.1, but that is not enough: another program on the computer, or a
 * page opened in the browser through DNS rebinding, could reach the port.
 * Electron draws a token on every run (TRAFFIC_COUNTER_TOKEN) and hands it
 * only to its own window, as a cookie; the server also rejects any Host other
 * than 127.0.0.1:<port>. Without TRAFFIC_COUNTER_TOKEN (next dev), nothing changes.
 */

export const TOKEN_COOKIE = "tc_token";

export function accessAllowed(token: string | undefined, host: string | null): boolean {
  const expected = process.env.TRAFFIC_COUNTER_TOKEN;
  if (!expected) return true;
  if (host !== `127.0.0.1:${process.env.PORT}`) return false;
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** For server actions that touch configuration or the disk (defense beyond the proxy). */
export async function requireAccess(): Promise<void> {
  const { cookies, headers } = await import("next/headers");
  const [c, h] = await Promise.all([cookies(), headers()]);
  if (!accessAllowed(c.get(TOKEN_COOKIE)?.value, h.get("host"))) throw new Error("Access denied.");
}
