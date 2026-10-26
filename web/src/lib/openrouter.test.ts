import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { dimensoesJpeg, MODELO_PADRAO, modelosDaSugestao, RESERVAS_PADRAO } from "./openrouter";

describe("modelosDaSugestao", () => {
  const salvo = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_MODELOS_RESERVA;
  });
  afterEach(() => {
    process.env = { ...salvo };
  });

  it("padrão: modelo principal e as reservas calibradas", () => {
    expect(modelosDaSugestao()).toEqual([MODELO_PADRAO, ...RESERVAS_PADRAO]);
  });

  it("OPENROUTER_MODEL troca o principal, que vem sempre primeiro e sem repetir", () => {
    process.env.OPENROUTER_MODEL = RESERVAS_PADRAO[1];
    expect(modelosDaSugestao()).toEqual([RESERVAS_PADRAO[1], RESERVAS_PADRAO[0]]);
  });

  it("OPENROUTER_MODELOS_RESERVA troca a lista; vazia ou 'nenhum' desliga", () => {
    process.env.OPENROUTER_MODELOS_RESERVA = " a/b , c/d ,";
    expect(modelosDaSugestao()).toEqual([MODELO_PADRAO, "a/b", "c/d"]);
    process.env.OPENROUTER_MODELOS_RESERVA = "";
    expect(modelosDaSugestao()).toEqual([MODELO_PADRAO]);
    process.env.OPENROUTER_MODELOS_RESERVA = " Nenhum ";
    expect(modelosDaSugestao()).toEqual([MODELO_PADRAO]);
  });

  it("opções explícitas (calibração) valem mais que o ambiente", () => {
    process.env.OPENROUTER_MODELOS_RESERVA = "x/y";
    expect(modelosDaSugestao({ modelo: "m/1", reservas: [] })).toEqual(["m/1"]);
  });
});

describe("dimensoesJpeg", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jpeg-teste-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  function jpeg(largura: number, altura: number, marcadorSof = 0xc0): string {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]);
    const sof = Buffer.from([0xff, marcadorSof, 0x00, 0x11, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 3, ...Array(9).fill(0)]);
    const p = path.join(dir, `${largura}x${altura}-${marcadorSof}.jpg`);
    fs.writeFileSync(p, Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sof, Buffer.from([0xff, 0xd9])]));
    return p;
  }

  it("lê largura e altura do cabeçalho (baseline e progressivo)", () => {
    expect(dimensoesJpeg(jpeg(480, 160))).toEqual({ largura: 480, altura: 160 });
    expect(dimensoesJpeg(jpeg(14000, 120, 0xc2))).toEqual({ largura: 14000, altura: 120 });
  });

  it("null para o que não é JPEG e para arquivo que não existe", () => {
    const p = path.join(dir, "texto.jpg");
    fs.writeFileSync(p, "não é imagem nenhuma, só texto");
    expect(dimensoesJpeg(p)).toBeNull();
    expect(dimensoesJpeg(path.join(dir, "nao-existe.jpg"))).toBeNull();
  });
});
