import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { temposDosQuadros } from "./mp4";

// MP4 mínimo montado caixa a caixa: só o que temposDosQuadros lê do moov.

function caixa(tipo: string, ...conteudo: Buffer[]): Buffer {
  const corpo = Buffer.concat(conteudo);
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(8 + corpo.length, 0);
  cab.write(tipo, 4, "latin1");
  return Buffer.concat([cab, corpo]);
}

function u32(...valores: number[]): Buffer {
  const b = Buffer.alloc(4 * valores.length);
  valores.forEach((v, i) => b.writeUInt32BE(v >>> 0, 4 * i));
  return b;
}

/** caixa "completa" (versão 0 + flags) seguida de uma tabela de pares */
function tabela(tipo: string, pares: [number, number][]): Buffer {
  return caixa(tipo, u32(0, pares.length), ...pares.map(([a, b]) => u32(a, b)));
}

function trilha(opcoes: { handler: string; escala: number; stts: [number, number][]; ctts?: [number, number][]; mediaTime?: number }): Buffer {
  const mdhd = caixa("mdhd", u32(0, 0, 0, opcoes.escala, 0), Buffer.alloc(4));
  const hdlr = caixa("hdlr", u32(0, 0), Buffer.from(opcoes.handler, "latin1"), Buffer.alloc(12));
  const stbl = caixa("stbl", tabela("stts", opcoes.stts), ...(opcoes.ctts ? [tabela("ctts", opcoes.ctts)] : []));
  const mdia = caixa("mdia", mdhd, hdlr, caixa("minf", stbl));
  const edts = opcoes.mediaTime === undefined ? [] : [caixa("edts", tabela("elst", [[1000, opcoes.mediaTime]]))];
  return caixa("trak", ...edts, mdia);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp4-teste-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function arquivo(nome: string, ...caixas: Buffer[]): string {
  const p = path.join(dir, nome);
  fs.writeFileSync(p, Buffer.concat(caixas));
  return p;
}

const ftyp = caixa("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1"));
const mdat = caixa("mdat", Buffer.alloc(64));

describe("temposDosQuadros", () => {
  it("segue a duração de cada quadro, inclusive os buracos de tempo do DVR", () => {
    // 3 quadros de 0,1 s, um que dura 0,5 s (o DVR pulou) e mais 2
    const v = trilha({ handler: "vide", escala: 1000, stts: [[3, 100], [1, 500], [2, 100]] });
    const p = arquivo("dvr.mp4", ftyp, mdat, caixa("moov", v));
    expect(temposDosQuadros(p)).toEqual([0, 0.1, 0.2, 0.3, 0.8, 0.9]);
  });

  it("aplica o deslocamento de composição (quadros B) e o corte do início (elst)", () => {
    // decodificação 0,100,200,300; exibição 100,400,200,300; a trilha começa em 100
    const v = trilha({ handler: "vide", escala: 1000, stts: [[4, 100]], ctts: [[1, 100], [1, 300], [2, 0]], mediaTime: 100 });
    const p = arquivo("b.mp4", ftyp, caixa("moov", v), mdat);
    expect(temposDosQuadros(p)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("ignora a trilha de áudio e usa a de vídeo", () => {
    const audio = trilha({ handler: "soun", escala: 48000, stts: [[10, 1024]] });
    const video = trilha({ handler: "vide", escala: 15, stts: [[3, 1]] });
    const p = arquivo("av.mp4", ftyp, caixa("moov", audio, video), mdat);
    expect(temposDosQuadros(p)).toEqual([0, 0.067, 0.133]);
  });

  it("null para o que não é MP4, para MP4 sem vídeo e para arquivo que não existe", () => {
    expect(temposDosQuadros(arquivo("texto.mp4", Buffer.from("não é um vídeo")))).toBeNull();
    const audio = trilha({ handler: "soun", escala: 48000, stts: [[10, 1024]] });
    expect(temposDosQuadros(arquivo("audio.m4a", ftyp, caixa("moov", audio)))).toBeNull();
    expect(temposDosQuadros(path.join(dir, "nao-existe.mp4"))).toBeNull();
  });
});
