import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCALES } from "../i18n/locales";
import { DEFAULT_FALLBACKS, DEFAULT_MODEL, jpegSize, parseCategory, suggestionContent, suggestionModels } from "./openrouter";
import { PROMPTS, SUGGESTIONS } from "./prompts";

describe("suggestionModels", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_FALLBACK_MODELS;
    delete process.env.OPENROUTER_MODELOS_RESERVA;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("default: the main model and the calibrated fallbacks", () => {
    expect(suggestionModels()).toEqual([DEFAULT_MODEL, ...DEFAULT_FALLBACKS]);
  });

  it("OPENROUTER_MODEL replaces the main one, which always comes first, without repetition", () => {
    process.env.OPENROUTER_MODEL = DEFAULT_FALLBACKS[1];
    expect(suggestionModels()).toEqual([DEFAULT_FALLBACKS[1], DEFAULT_FALLBACKS[0]]);
  });

  it("OPENROUTER_FALLBACK_MODELS replaces the list; empty or 'none' turns it off", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = " a/b , c/d ,";
    expect(suggestionModels()).toEqual([DEFAULT_MODEL, "a/b", "c/d"]);
    process.env.OPENROUTER_FALLBACK_MODELS = "";
    expect(suggestionModels()).toEqual([DEFAULT_MODEL]);
    process.env.OPENROUTER_FALLBACK_MODELS = " None ";
    expect(suggestionModels()).toEqual([DEFAULT_MODEL]);
  });

  it("the name before 0.0.8 still works (old config files)", () => {
    process.env.OPENROUTER_MODELOS_RESERVA = "nenhum";
    expect(suggestionModels()).toEqual([DEFAULT_MODEL]);
  });

  it("explicit options (calibration) win over the environment", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "x/y";
    expect(suggestionModels({ model: "m/1", fallbacks: [] })).toEqual(["m/1"]);
  });
});

describe("prompts", () => {
  it.each(LOCALES)("%s: one distinct word per category, usable as a JSON enum", (locale) => {
    const words = SUGGESTIONS.map((s) => PROMPTS[locale].labels[s]);
    expect(new Set(words).size).toBe(SUGGESTIONS.length);
    for (const w of words) expect(w).toMatch(/^[a-z_]+$/);
  });

  it.each(LOCALES)("%s: the instructions describe every category by its word", (locale) => {
    const p = PROMPTS[locale];
    // French puts a space before the colon
    for (const s of SUGGESTIONS) expect(p.instructions).toMatch(new RegExp(`^- ${p.labels[s]} ?:`, "m"));
    expect(p.detectorHint).toContain("{label}");
  });

  it.each(LOCALES)("%s: the model's word maps back to the internal category", (locale) => {
    for (const s of SUGGESTIONS) expect(parseCategory(PROMPTS[locale].labels[s], locale)).toBe(s);
    expect(parseCategory("bicycle?", locale)).toBeNull();
    expect(parseCategory(undefined, locale)).toBeNull();
  });
});

describe("jpegSize and suggestionContent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpeg-test-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  function jpeg(width: number, height: number, sofMarker = 0xc0): string {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]);
    const sof = Buffer.from([0xff, sofMarker, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, ...Array(9).fill(0)]);
    const p = path.join(dir, `${width}x${height}-${sofMarker}.jpg`);
    fs.writeFileSync(p, Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sof, Buffer.from([0xff, 0xd9])]));
    return p;
  }

  it("reads width and height from the header (baseline and progressive)", () => {
    expect(jpegSize(jpeg(480, 160))).toEqual({ width: 480, height: 160 });
    expect(jpegSize(jpeg(14000, 120, 0xc2))).toEqual({ width: 14000, height: 120 });
  });

  it("null for what is not a JPEG and for a missing file", () => {
    const p = path.join(dir, "text.jpg");
    fs.writeFileSync(p, "not an image at all, just text");
    expect(jpegSize(p)).toBeNull();
    expect(jpegSize(path.join(dir, "missing.jpg"))).toBeNull();
  });

  type Part = { type: string; text?: string };
  const texts = (parts: object[]) => (parts as Part[]).filter((p) => p.type === "text").map((p) => p.text);

  it("sends filmstrip and context with the labels in the app language", () => {
    const parts = suggestionContent({ filmstrip: jpeg(480, 160), context: jpeg(640, 360) }, "de");
    expect(texts(parts)).toEqual(["FILMSTRIP:", "KONTEXT:", "Klassifiziere das Objekt."]);
    expect((parts as Part[]).filter((p) => p.type === "image_url")).toHaveLength(2);
  });

  it("a filmstrip too wide for the model goes out; only the context is sent", () => {
    const parts = suggestionContent({ filmstrip: jpeg(14000, 120), context: jpeg(640, 360) }, "en");
    expect(texts(parts)[0]).toBe(PROMPTS.en.noFilmstrip);
    expect((parts as Part[]).filter((p) => p.type === "image_url")).toHaveLength(1);
  });

  it("the detector hint uses the category word of the prompt language", () => {
    const parts = suggestionContent({ filmstrip: jpeg(480, 160), detectorHint: "cyclists" }, "pt-BR");
    expect(texts(parts)).toContain("O detector automático (YOLO, pode errar) sugeriu: ciclista.");
  });
});
