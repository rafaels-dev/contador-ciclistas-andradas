import fs from "node:fs";

/**
 * Presentation time (s) of each video frame of an MP4/MOV, in the order they
 * appear — read from the `moov` tables (stts/ctts/elst), without decoding.
 *
 * The worker counts frames (frame ÷ fps), but DVR files have time gaps
 * (Andradas_06: 54,009 frames in 3,631 s, not 3,600): the browser's <video>
 * seeks by the recorded time. This table converts one into the other.
 * null if it is not an MP4/MOV or the structure is not recognized.
 */
export function frameTimes(file: string): number[] | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const moov = findMoov(fd, fs.fstatSync(fd).size);
    if (!moov) return null;
    for (const trak of children(moov, 0, moov.length, "trak")) {
      const mdia = child(moov, trak, "mdia");
      if (!mdia) continue;
      const hdlr = child(moov, mdia, "hdlr");
      if (!hdlr || moov.toString("latin1", hdlr.start + 8, hdlr.start + 12) !== "vide") continue;
      return trackTimes(moov, trak, mdia);
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

type Box = { start: number; end: number }; // box content (after the header)

function findMoov(fd: number, size: number): Buffer | null {
  const head = Buffer.alloc(16);
  let pos = 0;
  while (pos + 8 <= size) {
    fs.readSync(fd, head, 0, 16, pos);
    let len = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let header = 8;
    if (len === 1) {
      len = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (len === 0) len = size - pos;
    if (len < header) return null;
    if (type === "moov") {
      const buf = Buffer.alloc(len - header);
      fs.readSync(fd, buf, 0, buf.length, pos + header);
      return buf;
    }
    pos += len;
  }
  return null;
}

function* children(buf: Buffer, start: number, end: number, type?: string): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let len = buf.readUInt32BE(pos);
    let header = 8;
    if (len === 1) {
      len = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (len === 0) len = end - pos;
    if (len < header) return;
    if (!type || buf.toString("latin1", pos + 4, pos + 8) === type) yield { start: pos + header, end: pos + len };
    pos += len;
  }
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  return children(buf, parent.start, parent.end, type).next().value ?? undefined;
}

function trackTimes(buf: Buffer, trak: Box, mdia: Box): number[] | null {
  const mdhd = child(buf, mdia, "mdhd");
  const stbl = (() => {
    const minf = child(buf, mdia, "minf");
    return minf && child(buf, minf, "stbl");
  })();
  if (!mdhd || !stbl) return null;
  const version = buf.readUInt8(mdhd.start);
  const timescale = buf.readUInt32BE(mdhd.start + (version === 1 ? 20 : 12));
  if (!timescale) return null;

  // stts: duration (in decoding order) of each sample
  const stts = child(buf, stbl, "stts");
  if (!stts) return null;
  const dts: number[] = [];
  let t = 0;
  for (let i = 0, n = buf.readUInt32BE(stts.start + 4); i < n; i++) {
    const count = buf.readUInt32BE(stts.start + 8 + i * 8);
    const delta = buf.readUInt32BE(stts.start + 12 + i * 8);
    for (let k = 0; k < count; k++, t += delta) dts.push(t);
  }

  // ctts: composition offset (B frames shown out of decoding order)
  const ctts = child(buf, stbl, "ctts");
  if (ctts) {
    const v = buf.readUInt8(ctts.start);
    let s = 0;
    for (let i = 0, n = buf.readUInt32BE(ctts.start + 4); i < n; i++) {
      const count = buf.readUInt32BE(ctts.start + 8 + i * 8);
      const offset = v === 1 ? buf.readInt32BE(ctts.start + 12 + i * 8) : buf.readUInt32BE(ctts.start + 12 + i * 8);
      for (let k = 0; k < count && s < dts.length; k++, s++) dts[s] += offset;
    }
  }

  // elst: the start of the track may be cut (media_time of the first entry)
  let start = 0;
  const edts = child(buf, trak, "edts");
  const elst = edts && child(buf, edts, "elst");
  if (elst && buf.readUInt32BE(elst.start + 4) > 0) {
    const v = buf.readUInt8(elst.start);
    const mediaTime = v === 1 ? Number(buf.readBigInt64BE(elst.start + 8 + 8)) : buf.readInt32BE(elst.start + 8 + 4);
    if (mediaTime > 0) start = mediaTime;
  }

  return dts.sort((a, b) => a - b).map((x) => Math.round(((x - start) / timescale) * 1000) / 1000);
}
