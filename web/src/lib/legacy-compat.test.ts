import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyEnvText, setVariableText } from "./env";
import { adoptLegacyEnv, LEGACY_ENV } from "./legacy-env";
import { LEGACY_STORAGE, moveStorageKeys } from "./legacy-storage";

// names and paths from before 0.0.8 (Portuguese) keep working

describe("old environment variables", () => {
  it("are copied to the new names", () => {
    const env: Record<string, string | undefined> = { CONTADOR_DADOS: "/d", CONTADOR_SEM_NVDEC: "1", OPENROUTER_CONCORRENCIA: "4" };
    adoptLegacyEnv(env);
    expect(env).toMatchObject({ TRAFFIC_COUNTER_DATA: "/d", TRAFFIC_COUNTER_NO_NVDEC: "1", OPENROUTER_CONCURRENCY: "4" });
  });

  it("never override a new name already set", () => {
    const env: Record<string, string | undefined> = { CONTADOR_DADOS: "/old", TRAFFIC_COUNTER_DATA: "/new" };
    adoptLegacyEnv(env);
    expect(env.TRAFFIC_COUNTER_DATA).toBe("/new");
  });

  it("each new name is read somewhere in the code", () => {
    const root = path.resolve(__dirname, "../../..");
    const sources = ["web/src", "web/scripts", "worker", "desktop/main.cjs", "desktop/scripts", "desktop/data-folder.cjs", ".github/workflows"]
      .flatMap((p) => files(path.join(root, p)))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith("legacy-env.ts"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    for (const name of Object.values(LEGACY_ENV)) expect(sources, name).toContain(name);
  });
});

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p, { withFileTypes: true })
    .filter((e) => !["node_modules", "__pycache__", "dist", "resources", ".staging"].includes(e.name))
    .flatMap((e) => files(path.join(p, e.name)))
    .filter((f) => /\.(ts|tsx|mjs|cjs|py|yml)$/.test(f));
}

describe("config.env written by older versions", () => {
  it("reads the old variable names", () => {
    const env: Record<string, string | undefined> = {};
    applyEnvText('OPENROUTER_API_KEY=k\nOPENROUTER_CONCORRENCIA=3\nOPENROUTER_MODELOS_RESERVA="a,b"\nCONTADOR_ARQUIVOS_LOCAIS=0\n', env);
    expect(env).toEqual({ OPENROUTER_API_KEY: "k", OPENROUTER_CONCURRENCY: "3", OPENROUTER_FALLBACK_MODELS: "a,b", TRAFFIC_COUNTER_LOCAL_FILES: "0" });
  });

  it("the real environment wins over the file", () => {
    const env: Record<string, string | undefined> = { OPENROUTER_CONCURRENCY: "8" };
    applyEnvText("OPENROUTER_CONCORRENCIA=3\r\n", env);
    expect(env.OPENROUTER_CONCURRENCY).toBe("8");
  });

  it("saving replaces the old name's line, so the old value does not come back", () => {
    const text = setVariableText("OPENROUTER_API_KEY=k\nOPENROUTER_CONCORRENCIA=3\n# note\n", "OPENROUTER_CONCURRENCY", "6");
    expect(text).toBe("OPENROUTER_API_KEY=k\nOPENROUTER_CONCURRENCY=6\n# note\n");
    const env: Record<string, string | undefined> = {};
    applyEnvText(text, env);
    expect(env.OPENROUTER_CONCURRENCY).toBe("6");
  });

  it("saving keeps a single line when both names were there", () => {
    expect(setVariableText("OPENROUTER_CONCORRENCIA=3\nOPENROUTER_CONCURRENCY=4", "OPENROUTER_CONCURRENCY", "5")).toBe("OPENROUTER_CONCURRENCY=5\n");
    expect(setVariableText("", "OPENROUTER_API_KEY", "k")).toBe("OPENROUTER_API_KEY=k\n");
  });
});

describe("localStorage keys from before 0.0.8", () => {
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it("are the keys the old version wrote", () => {
    expect(Object.keys(LEGACY_STORAGE).sort()).toEqual(["contador:alturaTimeline", "contador:tema", "contador:ultima-pasta"]);
  });

  it("move to the new keys; a new value already saved wins", () => {
    const s = store({ "contador:tema": "dark", "contador:ultima-pasta": "C:\\Videos", "contador:alturaTimeline": "300", "tc:timelineHeight": "200" });
    moveStorageKeys(s, LEGACY_STORAGE);
    expect(Object.fromEntries(s.m)).toEqual({ "tc:theme": "dark", "tc:lastFolder": "C:\\Videos", "tc:timelineHeight": "200" });
  });

  it("work as the layout's inline script (function source only)", () => {
    const s = store({ "contador:tema": "light" });
    new Function("s", `(${moveStorageKeys.toString()})(s,${JSON.stringify(LEGACY_STORAGE)})`)(s);
    expect(Object.fromEntries(s.m)).toEqual({ "tc:theme": "light" });
  });
});
