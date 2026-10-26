import fs from "node:fs";
import type { Locale } from "../i18n/locales.ts";
import { PROMPTS, SUGGESTIONS, type Suggestion } from "./prompts.ts";

/**
 * Classification suggestion for a candidate by a vision model through
 * OpenRouter. No "@/" alias imports (and explicit .ts extensions): the
 * calibration script and the prompt evals (web/scripts, web/evals) run this
 * same code outside Next.
 */

export { SUGGESTIONS, type Suggestion };

// calibration (Oct/2026, 142 labeled night cases): Haiku 5.5 99–100%
// accuracy at ~US$ 0.18/thousand; Gemini 3.1 Flash Lite the same at 4×; YOLO alone 87%
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

/**
 * Fallbacks, in order: OpenRouter moves to the next one when the previous
 * fails (provider down, rate limit, "Provider returned error", moderation
 * refusal) and charges only the one that answered. Chosen by calibration —
 * see CLAUDE.md. OPENROUTER_FALLBACK_MODELS (comma-separated list) replaces
 * the list; empty or "none" turns it off.
 */
// calibration Oct/2026 (142 audited night / 31 day cases): DeepSeek V4.1 Flash 100%/97% at
// US$ 0.15/thousand; Gemini 3.1 Flash Lite 99%/100% at 0.83/thousand — providers other than Haiku's
export const DEFAULT_FALLBACKS = ["deepseek/deepseek-v4.1-flash-1017", "google/gemini-3.1-flash-lite"];

/** Main model + fallbacks, without repetition (the main one always first). */
export function suggestionModels(options: { model?: string; fallbacks?: string[] } = {}): string[] {
  const main = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  // OPENROUTER_MODELOS_RESERVA: the name before 0.0.8 (old config files)
  const env = process.env.OPENROUTER_FALLBACK_MODELS ?? process.env.OPENROUTER_MODELOS_RESERVA;
  const fallbacks =
    options.fallbacks ??
    (env === undefined ? DEFAULT_FALLBACKS : /^\s*(none|nenhum)?\s*$/i.test(env) ? [] : env.split(",").map((m) => m.trim()).filter(Boolean));
  return [...new Set([main, ...fallbacks])];
}

function schema(locale: Locale) {
  const p = PROMPTS[locale];
  return {
    name: "classification",
    strict: true,
    schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: SUGGESTIONS.map((s) => p.labels[s]) },
        confidence: { type: "number", description: "0 to 1" },
        reason: { type: "string", description: p.reason },
      },
      required: ["category", "confidence", "reason"],
      additionalProperties: false,
    },
  };
}

export type SuggestionResult = {
  category: Suggestion;
  confidence: number;
  reason: string;
  model: string;
  cost_usd: number | null;
  input_tokens: number | null;
};

export type SuggestionInput = {
  filmstrip: string; // JPG path
  context?: string | null;
  detectorHint?: string | null; // category suggested by YOLO, or null to not send it
};

function dataUrl(file: string): string {
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
}

/** Models reject images with a side > 8000 px (Claude) — margin for the others. */
export const MAX_IMAGE_SIDE = 7900;

/** Width × height of a JPEG reading only the header (SOF marker), with no image library. */
export function jpegSize(file: string): { width: number; height: number } | null {
  let b: Buffer;
  try {
    b = fs.readFileSync(file);
  } catch {
    return null;
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function fitsTheModel(file: string): boolean {
  const d = jpegSize(file);
  return !d || (d.width <= MAX_IMAGE_SIDE && d.height <= MAX_IMAGE_SIDE);
}

export class OpenRouterError extends Error {
  readonly status: number | null;
  /** worth retrying (network, 429, 5xx, malformed answer) */
  readonly transient: boolean;
  /** what OpenRouter/the provider actually returned (for diagnostics; the message is short) */
  readonly detail: string | null;

  constructor(message: string, status: number | null, transient: boolean, detail: string | null = null) {
    super(message);
    this.status = status;
    this.transient = transient;
    this.detail = detail;
  }
}

/** Sums up the OpenRouter error with what the provider answered ("Provider returned error" alone says nothing). */
function errorDetail(status: number, body: unknown, text: string): string {
  const e = (body as { error?: { code?: unknown; message?: unknown; metadata?: { provider_name?: unknown; raw?: unknown } } } | null)?.error;
  const parts = [`HTTP ${status}`];
  if (e?.code != null) parts.push(`code ${String(e.code)}`);
  if (e?.message) parts.push(String(e.message));
  if (e?.metadata?.provider_name) parts.push(`provider ${String(e.metadata.provider_name)}`);
  if (e?.metadata?.raw != null) parts.push(`response: ${typeof e.metadata.raw === "string" ? e.metadata.raw : JSON.stringify(e.metadata.raw)}`);
  if (!e && text) parts.push(`body: ${text}`);
  return parts.join(" · ").slice(0, 1500);
}

/** The user-message content (images + texts) in the prompt language. */
export function suggestionContent(input: SuggestionInput, locale: Locale): object[] {
  const p = PROMPTS[locale];
  // filmstrip too large (generated before the worker's limit): only the
  // context goes — without this the candidate failed forever, even on "Try again"
  const hasContext = !!input.context && fs.existsSync(input.context);
  const content: object[] =
    fitsTheModel(input.filmstrip) || !hasContext
      ? [{ type: "text", text: p.filmstrip }, { type: "image_url", image_url: { url: dataUrl(input.filmstrip) } }]
      : [{ type: "text", text: p.noFilmstrip }];
  if (input.context && hasContext) {
    content.push({ type: "text", text: p.context }, { type: "image_url", image_url: { url: dataUrl(input.context) } });
  }
  if (input.detectorHint) {
    const hint = p.labels[input.detectorHint as Suggestion] ?? input.detectorHint;
    content.push({ type: "text", text: p.detectorHint.replace("{label}", hint) });
  }
  content.push({ type: "text", text: p.classify });
  return content;
}

/** The model's JSON answer → internal category (null when it is not one of the prompt's words). */
export function parseCategory(word: string | undefined, locale: Locale): Suggestion | null {
  const labels = PROMPTS[locale].labels;
  return SUGGESTIONS.find((s) => labels[s] === word) ?? null;
}

export async function suggestCategory(
  input: SuggestionInput,
  /** fallbacks: [] turns off the fallback (calibration measures one model at a time) */
  options: { model?: string; fallbacks?: string[]; key?: string; signal?: AbortSignal; locale?: Locale } = {},
): Promise<SuggestionResult> {
  const key = options.key ?? process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError("OPENROUTER_API_KEY is not configured.", 401, false);
  const locale = options.locale ?? "en";
  const models = suggestionModels(options);
  const model = models[0];

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      cache: "no-store",
      // with fallbacks OpenRouter may try more than one model in the same call
      signal: options.signal ?? AbortSignal.timeout(models.length > 1 ? 120_000 : 60_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Traffic Counter",
      },
      body: JSON.stringify({
        // `models` = OpenRouter fallback; the answer says in `model` who answered
        ...(models.length > 1 ? { models } : { model }),
        temperature: 0,
        messages: [
          { role: "system", content: PROMPTS[locale].instructions },
          { role: "user", content: suggestionContent(input, locale) },
        ],
        response_format: { type: "json_schema", json_schema: schema(locale) },
      }),
    });
  } catch (e) {
    throw new OpenRouterError(`Network failure: ${(e as Error).message}`, null, true);
  }

  const raw = await res.text().catch(() => "");
  let body: {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number; prompt_tokens?: number };
    error?: { message?: string };
    model?: string;
  } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!res.ok || !body?.choices?.length) {
    const message = body?.error?.message ?? `HTTP ${res.status}`;
    const tried = models.length > 1 ? ` · models tried: ${models.join(", ")}` : "";
    throw new OpenRouterError(`OpenRouter: ${message}`, res.status, res.status === 429 || res.status >= 500 || res.ok, errorDetail(res.status, body, raw.slice(0, 600)) + tried);
  }

  const text = body.choices[0].message?.content ?? "";
  let data: { category?: string; confidence?: number; reason?: string };
  try {
    // some providers wrap the JSON in ```json ... ```
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new OpenRouterError(`Answer is not JSON: ${text.slice(0, 120)}`, res.status, true, `model ${body.model ?? model} · answer: ${text.slice(0, 600)}`);
  }
  const category = parseCategory(data.category, locale);
  if (!category) throw new OpenRouterError(`Invalid category: ${data.category}`, res.status, true, `model ${body.model ?? model} · answer: ${text.slice(0, 600)}`);

  return {
    category,
    confidence: Math.min(1, Math.max(0, Number(data.confidence) || 0)),
    reason: String(data.reason ?? "").slice(0, 300),
    model: body.model ?? model,
    cost_usd: body.usage?.cost ?? null,
    input_tokens: body.usage?.prompt_tokens ?? null,
  };
}

/** Why a key check failed — translated on screen (settings.key.*). */
export type KeyCheck = { ok: boolean; balance_usd: number | null; error?: "rejected" | "badResponse" | "offline"; status?: number };

/** Checks that the key works and how much balance it has (for the settings screen). */
export async function checkKey(key: string): Promise<KeyCheck> {
  const auth = { Authorization: `Bearer ${key}` };
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, balance_usd: null, error: "rejected" };
    if (!r.ok) return { ok: false, balance_usd: null, error: "badResponse", status: r.status };
    const c = await fetch("https://openrouter.ai/api/v1/credits", { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const data = c.ok ? ((await c.json()) as { data?: { total_credits?: number; total_usage?: number } }).data : undefined;
    const balance = data?.total_credits != null ? data.total_credits - (data.total_usage ?? 0) : null;
    return { ok: true, balance_usd: balance };
  } catch {
    return { ok: false, balance_usd: null, error: "offline" };
  }
}
