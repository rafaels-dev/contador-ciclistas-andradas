#!/usr/bin/env python3
"""
Final video of the review app: one or more videos in sequence, in a single
MP4, with the counting lines and a counter panel that SUMS across the videos
(lines with the same name are the same count).

Only events confirmed in the human review go in — the app builds the plan
from `candidates.label` (discarded ones are left out). On each event's frame
the counter goes up, the line flashes in the category color and the object
gets a box with the category name (trajectory from the detection tracks).

Usage:
  python worker/render.py --plan plan.json --output DIR [--end S]
plan.json: {"labels": {...}, "categories": [...] | null,
            "videos": [{"title", "video", "tracks", "lines": [...],
                        "events": [{"id", "frame", "line_id", "category", "direction", "track"}]}]}
`labels` carries the texts in the app language (panel, boxes, CSV); English
is the fallback.
Output: DIR/final_video.mp4, DIR/report.json, DIR/events.csv and, on stdout,
one JSON line per event ({"type": "progress"|"done"|"error"}).

Sequential reading (reader.py), as in the detection: the event frames are
the same indices the detector recorded.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import queue
import subprocess
import sys

# JSON events carry "→" and "…": on Windows stdout starts as cp1252
if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reader import VideoReader, _ffmpeg  # noqa: E402

CATEGORIES = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "cars", "motorcycles", "other"]
# fallback texts (the app sends them translated in plan["labels"])
DEFAULT_LABELS = {
    "title": "Count",
    "no_line": "No line",
    "video_n": "Video {n}/{total}",
    "plural": {"cyclists": "Cyclists", "kick_scooters": "Kick scooters", "mopeds": "Electric mopeds",
               "unicycles": "Unicycles", "pedestrians": "Pedestrians", "cars": "Cars",
               "motorcycles": "Motorcycles", "other": "Other"},
    "singular": {"cyclists": "Cyclist", "kick_scooters": "Kick scooter", "mopeds": "Electric moped",
                 "unicycles": "Unicycle", "pedestrians": "Pedestrian", "cars": "Car",
                 "motorcycles": "Motorcycle", "other": "Other"},
    "csv": ["video", "time_in_video", "time_in_final_video", "line", "category", "direction", "candidate"],
}
# RGB (PIL); OpenCV gets it reversed. The same category colors as the app
# (--color-cat-* in web/src/app/globals.css)
COLOR = {"cyclists": (47, 191, 98), "kick_scooters": (23, 179, 163), "mopeds": (139, 100, 240),
         "unicycles": (234, 79, 115), "pedestrians": (61, 130, 240), "cars": (244, 123, 32),
         "motorcycles": (210, 75, 234), "other": (160, 154, 147)}
LINE_COLOR = (250, 204, 21)

BEFORE_S, AFTER_S = 1.5, 1.0  # object box around the event
FLASH_S = 0.6                 # line in the category color after the event
OUTPUT_WIDTH = 1920


def emit(**data) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


def bgr(rgb) -> tuple[int, int, int]:
    return (rgb[2], rgb[1], rgb[0])


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = (["DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf"] if bold else ["DejaVuSans.ttf", "arial.ttf", "Arial.ttf"])
    folders = ["/usr/share/fonts/truetype/dejavu", "C:/Windows/Fonts", "/Library/Fonts",
               "/System/Library/Fonts/Supplemental", ""]
    for n in names:
        for p in folders:
            try:
                return ImageFont.truetype(str(Path(p) / n) if p else n, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


class Tags:
    """Texts (with accents — OpenCV's Hershey font has none) as RGBA, cached."""

    def __init__(self, scale: float):
        self.f = font(int(22 * scale), bold=True)
        self.cache: dict = {}

    def img(self, text: str, color) -> np.ndarray:
        k = (text, color)
        if k not in self.cache:
            l, t, r, b = self.f.getbbox(text)
            im = Image.new("RGBA", (r - l + 12, b - t + 8), (*color, 230))
            ImageDraw.Draw(im).text((6 - l, 4 - t), text, font=self.f, fill=(255, 255, 255, 255))
            self.cache[k] = np.array(im)
        return self.cache[k]


def paste(frame: np.ndarray, rgba: np.ndarray, x: int, y: int) -> None:
    """Overlays an RGBA image at (x, y), clipping at the edges."""
    h, w = rgba.shape[:2]
    H, W = frame.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    sub = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    a = sub[:, :, 3:4].astype(np.float32) / 255
    roi = frame[y0:y1, x0:x1]
    roi[:] = (roi * (1 - a) + sub[:, :, 2::-1] * a).astype(np.uint8)


class Panel:
    """Counters per line (summing the videos), redrawn only when they change."""

    def __init__(self, line_cats: dict[str, list[str]], scale: float, labels: dict):
        self.line_cats = line_cats
        self.e = scale
        self.labels = labels
        self.f_title = font(int(24 * scale), bold=True)
        self.f_line = font(int(21 * scale), bold=True)
        self.f_cat = font(int(20 * scale))
        self.key = None
        self.img: np.ndarray | None = None

    def draw(self, totals: dict, footer: str, highlight: set) -> np.ndarray:
        key = (json.dumps(totals, sort_keys=True), footer, tuple(sorted(highlight)))
        if key == self.key:
            return self.img
        e = self.e
        pad, cat_h, line_h = int(14 * e), int(28 * e), int(34 * e)
        width = int(380 * e)
        height = pad * 2 + int(36 * e) + int(28 * e)
        for cats in self.line_cats.values():
            height += line_h + cat_h * len(cats) + int(6 * e)
        im = Image.new("RGBA", (width, height), (15, 15, 20, 190))
        d = ImageDraw.Draw(im)
        y = pad
        d.text((pad, y), self.labels["title"], font=self.f_title, fill=(255, 255, 255, 255))
        y += int(36 * e)
        for name, cats in self.line_cats.items():
            d.text((pad, y), name, font=self.f_line, fill=(*LINE_COLOR, 255))
            y += line_h
            for c in cats:
                n = totals.get(name, {}).get(c, 0)
                if (name, c) in highlight:
                    d.rounded_rectangle((pad - 4, y - 2, width - pad + 4, y + cat_h - 4),
                                        radius=int(6 * e), fill=(*COLOR[c], 120))
                d.ellipse((pad, y + int(6 * e), pad + int(12 * e), y + int(18 * e)), fill=(*COLOR[c], 255))
                d.text((pad + int(22 * e), y), self.labels["plural"][c], font=self.f_cat, fill=(235, 235, 235, 255))
                txt = str(n)
                w = d.textlength(txt, font=self.f_line)
                d.text((width - pad - w, y - 1), txt, font=self.f_line, fill=(255, 255, 255, 255))
                y += cat_h
            y += int(6 * e)
        d.text((pad, height - pad - int(22 * e)), footer, font=self.f_cat, fill=(170, 170, 170, 255))
        self.key, self.img = key, np.array(im)
        return self.img


class Encoder:
    """ffmpeg reading raw BGR from stdin: NVENC if available, otherwise libx264."""

    def __init__(self, target: Path, width: int, height: int, fps: float):
        ff = _ffmpeg()
        source = ["-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", f"{fps:.6f}", "-i", "-"]
        # 2 Mbit/s cap: a street camera with swaying trees blows up the
        # bitrate (cq 26 with no cap gave ~2.4 GB per 2 h video)
        nvenc = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "28", "-b:v", "1500k",
                 "-maxrate", "2M", "-bufsize", "4M"]
        x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M"]
        self.codec = "h264_nvenc" if self._works(ff, nvenc) else "libx264"
        cmd = [ff, "-hide_banner", "-loglevel", "error", "-y", *source,
               *(nvenc if self.codec == "h264_nvenc" else x264),
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(target)]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        # pipe writes in a thread (writing releases the GIL): drawing the next
        # frame and sending the previous one to ffmpeg happen together
        self.queue: queue.Queue = queue.Queue(maxsize=16)
        self.failure: BaseException | None = None
        self.thread = threading.Thread(target=self._write_loop, daemon=True)
        self.thread.start()

    def _write_loop(self) -> None:
        while (frame := self.queue.get()) is not None:
            if self.failure is None:
                try:
                    self.proc.stdin.write(memoryview(frame).cast("B"))
                except BaseException as e:  # ffmpeg died: the error surfaces in close()
                    self.failure = e

    @staticmethod
    def _works(ff: str, params: list[str]) -> bool:
        test = [ff, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2",
                *params, "-f", "null", "-"]
        try:
            return subprocess.run(test, capture_output=True, timeout=30).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def write(self, frame: np.ndarray) -> None:
        if self.failure is not None:
            raise RuntimeError(f"ffmpeg stopped accepting frames: {self.failure}")
        self.queue.put(np.ascontiguousarray(frame))

    def close(self) -> None:
        self.queue.put(None)
        self.thread.join()
        self.proc.stdin.close()
        err = self.proc.stderr.read().decode(errors="replace")
        if self.proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {err.strip()[-500:]}")


def load_boxes(tracks_file: str | None, tracks: set[str]) -> dict[str, dict[int, tuple]]:
    """track → {frame: box} (processed frame space), only for the tracks used."""
    if not tracks_file or not Path(tracks_file).exists():
        return {}
    with gzip.open(tracks_file, "rt", encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for t in data["tracks"]:
        key = f"{t['group']}:{t['tid']}"
        if key in tracks:
            out[key] = dict(zip(t["frames"], (tuple(c) for c in t["boxes"])))
    return out


def frames_of(reader: VideoReader, limit: int | None):
    """Reads ahead in a thread (ffmpeg/YUV→BGR release the GIL)."""
    q: queue.Queue = queue.Queue(maxsize=16)

    def read() -> None:
        n = 0
        while limit is None or n < limit:
            f = reader.read()
            if f is None:
                break
            q.put(f)
            n += 1
        q.put(None)

    threading.Thread(target=read, daemon=True).start()
    while (f := q.get()) is not None:
        yield f


def hms(s: float) -> str:
    s = int(round(s))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--end", type=float, default=None, help="seconds per video (tests)")
    args = ap.parse_args()
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    videos = plan["videos"]
    if not videos:
        raise ValueError("no videos in the plan")
    labels = {**DEFAULT_LABELS, **(plan.get("labels") or {})}

    # lines with the same name add up; categories shown = the ones the line
    # counts (if configured) plus the ones with a confirmed event
    no_line = labels["no_line"]
    line_cats: dict[str, list[str]] = {}
    for v in videos:
        names = {l["id"]: l["name"] for l in v["lines"]}
        for l in v["lines"]:
            cats = line_cats.setdefault(l["name"], [])
            cats += [c for c in (l.get("categories") or []) if c not in cats]
        for ev in v["events"]:
            name = names.get(ev["line_id"], no_line)
            cats = line_cats.setdefault(name, [])
            if ev["category"] not in cats:
                cats.append(ev["category"])
    # categories chosen for this final video (the runner already filtered the
    # events; here what the user left out disappears from the panel)
    chosen = plan.get("categories")
    if chosen:
        line_cats = {k: [c for c in cats if c in chosen] for k, cats in line_cats.items()}
    line_cats = {k: sorted(c, key=CATEGORIES.index) for k, c in line_cats.items() if c}

    readers = [VideoReader(v["video"]) for v in videos]
    for r in readers:
        r.close()  # only the size for now; reopened on each video's turn
    width = min(OUTPUT_WIDTH, readers[0].width)
    height = int(round(width * readers[0].height / readers[0].width / 2)) * 2
    fps = float(readers[0].info["fps"])
    scale = height / 1080
    total_f = sum(min(r.info["frames"], int(args.end * fps) if args.end else 10**12) for r in readers)

    target = output / "final_video.mp4"
    enc = Encoder(target, width, height, fps)
    emit(type="progress", stage="rendering", p=0, codec=enc.codec)
    panel = Panel(line_cats, scale, labels)
    tags = Tags(scale)
    totals: dict[str, dict[str, int]] = {}
    directions: dict[str, dict[str, dict[str, int]]] = {}
    report_rows = []
    video_summary = []
    done, t0, last_emit, final_start = 0, time.time(), 0.0, 0.0

    for iv, v in enumerate(videos):
        reader = VideoReader(v["video"])
        fv = float(reader.info["fps"])
        # processed frame → output (same aspect: scale only; other aspect: black bars)
        s = min(width / reader.width, height / reader.height)
        ox, oy = int((width - reader.width * s) / 2), int((height - reader.height * s) / 2)
        segs = [(l["name"], (int(l["x1"] * reader.width * s + ox), int(l["y1"] * reader.height * s + oy)),
                 (int(l["x2"] * reader.width * s + ox), int(l["y2"] * reader.height * s + oy))) for l in v["lines"]]
        line_name = {l["id"]: l["name"] for l in v["lines"]}
        events = sorted(v["events"], key=lambda e: e["frame"])
        boxes = load_boxes(v.get("tracks"), {e["track"] for e in events if e.get("track")})
        before, after, flash = int(BEFORE_S * fv), int(AFTER_S * fv), int(FLASH_S * fv)
        by_frame: dict[int, list[dict]] = {}
        for e in events:
            by_frame.setdefault(e["frame"], []).append(e)
        limit = int(args.end * fv) if args.end else None
        footer = (labels["video_n"].format(n=iv + 1, total=len(videos)) + f" · {v['title']}"
                  if len(videos) > 1 else v["title"])
        video_counts: dict[str, dict[str, int]] = {}
        next_i = 0
        idx = -1
        for frame in frames_of(reader, limit):
            idx += 1
            if s != 1.0 or ox or oy:
                canvas = np.zeros((height, width, 3), np.uint8)
                r = cv2.resize(frame, (int(reader.width * s), int(reader.height * s)), interpolation=cv2.INTER_AREA)
                canvas[oy:oy + r.shape[0], ox:ox + r.shape[1]] = r
                frame = canvas

            for e in by_frame.get(idx, ()):
                name = line_name.get(e["line_id"], no_line)
                totals.setdefault(name, {}).setdefault(e["category"], 0)
                totals[name][e["category"]] += 1
                video_counts.setdefault(name, {}).setdefault(e["category"], 0)
                video_counts[name][e["category"]] += 1
                direction = e.get("direction") or "—"
                dc = directions.setdefault(name, {}).setdefault(e["category"], {})
                dc[direction] = dc.get(direction, 0) + 1
                report_rows.append({"video": v["title"], "candidate": e["id"], "line": name,
                                    "category": e["category"], "direction": direction,
                                    "time_in_video_s": round(idx / fv, 2),
                                    "time_in_final_s": round(final_start + idx / fv, 2)})

            # events around this frame: object box, flashing line
            while next_i < len(events) and events[next_i]["frame"] + after < idx:
                next_i += 1
            active = [e for e in events[next_i:] if e["frame"] - before <= idx]
            flashing = {}
            highlight = set()
            for e in active:
                if 0 <= idx - e["frame"] <= flash:
                    flashing[line_name.get(e["line_id"])] = COLOR[e["category"]]
                    highlight.add((line_name.get(e["line_id"], no_line), e["category"]))
            for name, a, b in segs:
                color = flashing.get(name, LINE_COLOR)
                cv2.line(frame, a, b, bgr(color), max(2, int(4 * scale)) + (3 if name in flashing else 0), cv2.LINE_AA)
            for e in active:
                box = boxes.get(e.get("track"), {}).get(idx)
                if box is None:
                    continue
                x1, y1, x2, y2 = (int(box[0] * s + ox), int(box[1] * s + oy), int(box[2] * s + ox), int(box[3] * s + oy))
                color = COLOR[e["category"]]
                cv2.rectangle(frame, (x1, y1), (x2, y2), bgr(color), max(2, int(3 * scale)))
                txt = labels["singular"][e["category"]] + (" +1" if idx >= e["frame"] else "")
                tag = tags.img(txt, color)
                paste(frame, tag, x1, y1 - tag.shape[0] - 2)
            for name, a, b in segs:
                tag = tags.img(name, (120, 90, 0))
                paste(frame, tag, a[0] + 6, a[1] + 6)
            m = int(16 * scale)
            paste(frame, panel.draw(totals, footer, highlight), m, m)
            enc.write(frame)
            done += 1

            now = time.time()
            if now - last_emit >= 1.0:
                last_emit = now
                emit(type="progress", stage="rendering", p=min(done / max(total_f, 1), 1.0),
                     fps=round(done / (now - t0), 1), video=iv + 1, videos=len(videos))
        reader.close()
        dur = (idx + 1) / fv
        video_summary.append({"title": v["title"], "start_in_final_s": round(final_start, 2),
                              "duration_s": round(dur, 2), "totals": video_counts})
        final_start += dur
    enc.close()

    report = {"generated_at": datetime.now().isoformat(timespec="seconds"), "codec": enc.codec,
              "totals": totals, "by_direction": directions, "videos": video_summary, "events": report_rows}
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(output / "events.csv", "w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel opens accents right
        w = csv.writer(f, delimiter=";")
        w.writerow(labels["csv"])
        for r in report_rows:
            w.writerow([r["video"], hms(r["time_in_video_s"]), hms(r["time_in_final_s"]), r["line"],
                        labels["singular"][r["category"]], r["direction"], r["candidate"]])
    emit(type="done", events=len(report_rows), duration_s=round(final_start, 1), codec=enc.codec)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the app shows the message
        emit(type="error", message=f"{type(e).__name__}: {e}")
        raise
