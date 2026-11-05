/**
 * Texts written to the database by background work (progress, errors) are
 * shown later, in whatever language the app is in at that moment. They are
 * stored as a translatable message — `{"$t": key, "v": values}` — and
 * translated on screen. Plain text (worker exceptions, older data) shows as is.
 */

export type MessageValues = Record<string, string | number>;
export type StoredMessage = { $t: string; v?: MessageValues };

export function msg(key: string, values?: MessageValues): string {
  return JSON.stringify(values ? { $t: key, v: values } : { $t: key });
}

export function parseMessage(text: string | null | undefined): StoredMessage | null {
  if (!text || text[0] !== "{") return null;
  try {
    const m = JSON.parse(text) as StoredMessage;
    return typeof m.$t === "string" ? m : null;
  } catch {
    return null;
  }
}

/** Translates a stored text with `t` (from useTranslations()/getTranslations() at the root). */
export function formatStored(t: (key: string, values?: MessageValues) => string, text: string | null | undefined): string {
  if (!text) return "";
  const m = parseMessage(text);
  if (!m) return text;
  // a value may itself be a stored message (e.g. the uv error inside "failed: {detail}")
  const values = m.v && Object.fromEntries(Object.entries(m.v).map(([k, v]) => [k, typeof v === "string" && parseMessage(v) ? formatStored(t, v) : v]));
  try {
    return t(m.$t, values);
  } catch {
    return m.$t;
  }
}
