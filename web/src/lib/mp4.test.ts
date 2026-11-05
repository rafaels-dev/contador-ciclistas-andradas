import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { frameTimes } from "./mp4";

// Minimal MP4 built box by box: only what frameTimes reads from moov.

function box(type: string, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

function u32(...values: number[]): Buffer {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, 4 * i));
  return b;
}

/** "full" box (version 0 + flags) followed by a table of pairs */
function table(type: string, pairs: [number, number][]): Buffer {
  return box(type, u32(0, pairs.length), ...pairs.map(([a, b]) => u32(a, b)));
}

function track(options: { handler: string; timescale: number; stts: [number, number][]; ctts?: [number, number][]; mediaTime?: number }): Buffer {
  const mdhd = box("mdhd", u32(0, 0, 0, options.timescale, 0), Buffer.alloc(4));
  const hdlr = box("hdlr", u32(0, 0), Buffer.from(options.handler, "latin1"), Buffer.alloc(12));
  const stbl = box("stbl", table("stts", options.stts), ...(options.ctts ? [table("ctts", options.ctts)] : []));
  const mdia = box("mdia", mdhd, hdlr, box("minf", stbl));
  const edts = options.mediaTime === undefined ? [] : [box("edts", table("elst", [[1000, options.mediaTime]]))];
  return box("trak", ...edts, mdia);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp4-test-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function file(name: string, ...boxes: Buffer[]): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.concat(boxes));
  return p;
}

const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1"));
const mdat = box("mdat", Buffer.alloc(64));

describe("frameTimes", () => {
  it("follows each frame's duration, including the DVR's time gaps", () => {
    // 3 frames of 0.1 s, one lasting 0.5 s (the DVR skipped) and 2 more
    const v = track({ handler: "vide", timescale: 1000, stts: [[3, 100], [1, 500], [2, 100]] });
    const p = file("dvr.mp4", ftyp, mdat, box("moov", v));
    expect(frameTimes(p)).toEqual([0, 0.1, 0.2, 0.3, 0.8, 0.9]);
  });

  it("applies the composition offset (B frames) and the start cut (elst)", () => {
    // decoding 0,100,200,300; display 100,400,200,300; the track starts at 100
    const v = track({ handler: "vide", timescale: 1000, stts: [[4, 100]], ctts: [[1, 100], [1, 300], [2, 0]], mediaTime: 100 });
    const p = file("b.mp4", ftyp, box("moov", v), mdat);
    expect(frameTimes(p)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("ignores the audio track and uses the video one", () => {
    const audio = track({ handler: "soun", timescale: 48000, stts: [[10, 1024]] });
    const video = track({ handler: "vide", timescale: 15, stts: [[3, 1]] });
    const p = file("av.mp4", ftyp, box("moov", audio, video), mdat);
    expect(frameTimes(p)).toEqual([0, 0.067, 0.133]);
  });

  it("null for what is not MP4, for MP4 without video and for a missing file", () => {
    expect(frameTimes(file("text.mp4", Buffer.from("not a video")))).toBeNull();
    const audio = track({ handler: "soun", timescale: 48000, stts: [[10, 1024]] });
    expect(frameTimes(file("audio.m4a", ftyp, box("moov", audio)))).toBeNull();
    expect(frameTimes(path.join(dir, "missing.mp4"))).toBeNull();
  });
});
