import fs from "node:fs";
import path from "node:path";
import {
  isArgumentElement, isDateElement, isNumberElement, isPluralElement, isSelectElement, isTagElement, isTimeElement, parse, type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import { LOCALES, matchLocale, parseAcceptLanguage } from "./locales";
import { formatStored, msg, parseMessage } from "./message";

const MESSAGES = path.resolve(__dirname, "..", "..", "messages");
const load = (locale: string) => JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")) as Record<string, unknown>;
const flatten = (o: Record<string, unknown>, prefix = ""): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? Object.entries(flatten(v as Record<string, unknown>, `${prefix}${k}.`)) : [[`${prefix}${k}`, String(v)]])),
  );
type Arg = { name: string; kind: "plain" | "number" | "select" | "tag" };
/** Arguments and tags of an ICU message — a translation must use the same ones (branch texts may differ). */
function args(text: string): Arg[] {
  const found = new Map<string, Arg>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (isArgumentElement(el) || isDateElement(el) || isTimeElement(el)) found.set(el.value, found.get(el.value) ?? { name: el.value, kind: "plain" });
      else if (isNumberElement(el)) found.set(el.value, { name: el.value, kind: "number" });
      else if (isPluralElement(el) || isSelectElement(el)) {
        found.set(el.value, { name: el.value, kind: isPluralElement(el) ? "number" : "select" });
        for (const o of Object.values(el.options)) walk(o.value);
      } else if (isTagElement(el)) {
        found.set(el.value, { name: el.value, kind: "tag" });
        walk(el.children);
      }
    }
  };
  walk(parse(text));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

describe("matchLocale", () => {
  it("exact language first, then the base language", () => {
    expect(matchLocale(["pt-BR"])).toBe("pt-BR");
    expect(matchLocale(["pt-PT", "en"])).toBe("pt-BR");
    expect(matchLocale(["de-AT"])).toBe("de");
    expect(matchLocale(["nl_BE"])).toBe("nl");
    expect(matchLocale(["ja-JP", "fr-CA"])).toBe("fr");
  });

  it("nothing supported: null", () => {
    expect(matchLocale(["ja-JP", "zh"])).toBeNull();
    expect(matchLocale(["", " "])).toBeNull();
  });
});

describe("parseAcceptLanguage", () => {
  it("orders by q, keeping the header order on ties", () => {
    expect(parseAcceptLanguage("da;q=0.5, en-US, it;q=0.9, *;q=0.1")).toEqual(["en-US", "it", "da"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
});

describe("stored messages", () => {
  const t = createTranslator({
    locale: "en",
    onError: () => {}, // the unknown-key case below; the screen logs it
    messages: { a: { hello: "Hello {name}", failed: "It did not work: {detail}", n: "{n, plural, one {# video} other {# videos}}" } } as Record<string, unknown>,
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  it("are translated on screen in the current language", () => {
    expect(formatStored(t, msg("a.hello", { name: "Ana" }))).toBe("Hello Ana");
    expect(formatStored(t, msg("a.n", { n: 2 }))).toBe("2 videos");
  });

  it("a value may itself be a stored message", () => {
    expect(formatStored(t, msg("a.failed", { detail: msg("a.n", { n: 1 }) }))).toBe("It did not work: 1 video");
  });

  it("plain text (older data, worker exceptions) shows as is", () => {
    expect(formatStored(t, "Interrompido: o servidor foi reiniciado.")).toBe("Interrompido: o servidor foi reiniciado.");
    expect(formatStored(t, "{not a message}")).toBe("{not a message}");
    expect(parseMessage(null)).toBeNull();
    expect(formatStored(t, null)).toBe("");
  });

  it("an unknown key shows the key instead of breaking the screen", () => {
    expect(formatStored(t, msg("a.gone"))).toBe("a.gone");
  });
});

describe("message files", () => {
  const en = flatten(load("en"));

  it.each(LOCALES.filter((l) => l !== "en"))("%s has exactly the keys of en.json, with the same arguments", (locale) => {
    const other = flatten(load(locale));
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) expect([key, args(other[key])]).toEqual([key, args(text)]);
  });

  it.each(LOCALES)("%s: every message formats", (locale) => {
    const messages = load(locale);
    const t = createTranslator({ locale, messages, onError: (e) => { throw e; } }) as unknown as {
      (key: string, values?: object): string;
      markup: (key: string, values?: object) => string;
    };
    for (const [key, text] of Object.entries(flatten(messages))) {
      const list = args(text);
      const values = Object.fromEntries(
        list.map((a) => [a.name, a.kind === "number" ? 2 : a.kind === "select" ? "other" : a.kind === "tag" ? (chunks: string) => chunks : "x"]),
      );
      const format = list.some((a) => a.kind === "tag") ? () => t.markup(key, values) : () => t(key, values);
      expect(format, `${locale}: ${key}`).not.toThrow();
    }
  });
});
