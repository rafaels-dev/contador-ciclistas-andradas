import fs from "node:fs";

/**
 * Tempo de exibição (s) de cada quadro de vídeo de um MP4/MOV, na ordem em que
 * aparecem — lido das tabelas do `moov` (stts/ctts/elst), sem decodificar.
 *
 * O worker conta quadros (quadro ÷ fps), mas os arquivos de DVR têm buracos no
 * tempo (Andradas_06: 54.009 quadros em 3.631 s, não 3.600): o <video> do
 * navegador posiciona pelo tempo gravado. Esta tabela converte um no outro.
 * null se não for MP4/MOV ou se a estrutura não for reconhecida.
 */
export function temposDosQuadros(arquivo: string): number[] | null {
  let fd: number;
  try {
    fd = fs.openSync(arquivo, "r");
  } catch {
    return null;
  }
  try {
    const moov = acharMoov(fd, fs.fstatSync(fd).size);
    if (!moov) return null;
    for (const trak of filhos(moov, 0, moov.length, "trak")) {
      const mdia = filho(moov, trak, "mdia");
      if (!mdia) continue;
      const hdlr = filho(moov, mdia, "hdlr");
      if (!hdlr || moov.toString("latin1", hdlr.ini + 8, hdlr.ini + 12) !== "vide") continue;
      return temposDaTrilha(moov, trak, mdia);
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

type Caixa = { ini: number; fim: number }; // conteúdo da caixa (depois do cabeçalho)

function acharMoov(fd: number, tamanho: number): Buffer | null {
  const cab = Buffer.alloc(16);
  let pos = 0;
  while (pos + 8 <= tamanho) {
    fs.readSync(fd, cab, 0, 16, pos);
    let tam = cab.readUInt32BE(0);
    const tipo = cab.toString("latin1", 4, 8);
    let cabecalho = 8;
    if (tam === 1) {
      tam = Number(cab.readBigUInt64BE(8));
      cabecalho = 16;
    } else if (tam === 0) tam = tamanho - pos;
    if (tam < cabecalho) return null;
    if (tipo === "moov") {
      const buf = Buffer.alloc(tam - cabecalho);
      fs.readSync(fd, buf, 0, buf.length, pos + cabecalho);
      return buf;
    }
    pos += tam;
  }
  return null;
}

function* filhos(buf: Buffer, ini: number, fim: number, tipo?: string): Generator<Caixa> {
  let pos = ini;
  while (pos + 8 <= fim) {
    let tam = buf.readUInt32BE(pos);
    let cabecalho = 8;
    if (tam === 1) {
      tam = Number(buf.readBigUInt64BE(pos + 8));
      cabecalho = 16;
    } else if (tam === 0) tam = fim - pos;
    if (tam < cabecalho) return;
    if (!tipo || buf.toString("latin1", pos + 4, pos + 8) === tipo) yield { ini: pos + cabecalho, fim: pos + tam };
    pos += tam;
  }
}

function filho(buf: Buffer, pai: Caixa, tipo: string): Caixa | undefined {
  return filhos(buf, pai.ini, pai.fim, tipo).next().value ?? undefined;
}

function temposDaTrilha(buf: Buffer, trak: Caixa, mdia: Caixa): number[] | null {
  const mdhd = filho(buf, mdia, "mdhd");
  const stbl = (() => {
    const minf = filho(buf, mdia, "minf");
    return minf && filho(buf, minf, "stbl");
  })();
  if (!mdhd || !stbl) return null;
  const versao = buf.readUInt8(mdhd.ini);
  const escala = buf.readUInt32BE(mdhd.ini + (versao === 1 ? 20 : 12));
  if (!escala) return null;

  // stts: duração (em decodificação) de cada amostra
  const stts = filho(buf, stbl, "stts");
  if (!stts) return null;
  const dts: number[] = [];
  let t = 0;
  for (let i = 0, n = buf.readUInt32BE(stts.ini + 4); i < n; i++) {
    const quantos = buf.readUInt32BE(stts.ini + 8 + i * 8);
    const delta = buf.readUInt32BE(stts.ini + 12 + i * 8);
    for (let k = 0; k < quantos; k++, t += delta) dts.push(t);
  }

  // ctts: deslocamento de composição (quadros B mostrados fora da ordem de decodificação)
  const ctts = filho(buf, stbl, "ctts");
  if (ctts) {
    const v = buf.readUInt8(ctts.ini);
    let s = 0;
    for (let i = 0, n = buf.readUInt32BE(ctts.ini + 4); i < n; i++) {
      const quantos = buf.readUInt32BE(ctts.ini + 8 + i * 8);
      const desloc = v === 1 ? buf.readInt32BE(ctts.ini + 12 + i * 8) : buf.readUInt32BE(ctts.ini + 12 + i * 8);
      for (let k = 0; k < quantos && s < dts.length; k++, s++) dts[s] += desloc;
    }
  }

  // elst: o início da trilha pode ser cortado (media_time da primeira entrada)
  let inicio = 0;
  const edts = filho(buf, trak, "edts");
  const elst = edts && filho(buf, edts, "elst");
  if (elst && buf.readUInt32BE(elst.ini + 4) > 0) {
    const v = buf.readUInt8(elst.ini);
    const mediaTime = v === 1 ? Number(buf.readBigInt64BE(elst.ini + 8 + 8)) : buf.readInt32BE(elst.ini + 8 + 4);
    if (mediaTime > 0) inicio = mediaTime;
  }

  return dts.sort((a, b) => a - b).map((x) => Math.round(((x - inicio) / escala) * 1000) / 1000);
}
