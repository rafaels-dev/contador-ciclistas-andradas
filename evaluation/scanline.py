#!/usr/bin/env python3
"""
Space-time diagram of the counting line ("virtual inductive loop").

For each frame, extracts the pixel column at x = line_x (mean over a ±3 px
window) and stacks the columns along the time axis. Every object that
crosses the line shows up as a vertical smear — countable by eye, giving
near-exact ground truth without ML.

Writes 1 PNG per time window, with minute marks and the algorithm's counts
(events.jsonl) overlaid as triangles at the bottom.

Usage:
    python evaluation/scanline.py evaluation/videos/Andradas_07.mp4 \
        --start 600 --end 900 --events evaluation/diag_07/events.jsonl \
        --output evaluation/diag_07/scan_10to15min.png
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config
import legacy

COLORS = {"cyclists": (0, 255, 0), "pedestrians": (0, 255, 255),
          "cars": (0, 128, 255), "motorcycles": (255, 128, 0)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--start", type=float, default=0, help="seconds")
    p.add_argument("--end", type=float, required=True, help="seconds")
    p.add_argument("--events", default=None,
                   help="events.jsonl from run_instrumented.py (old eventos.jsonl also works)")
    p.add_argument("--output", required=True)
    p.add_argument("--y0", type=int, default=250)
    p.add_argument("--y1", type=int, default=1080)
    args = p.parse_args()

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    f0, f1 = int(args.start * fps), int(args.end * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, f0)

    lx = config.LINE_X
    cols = []
    for f in range(f0, f1):
        ok, fr = cap.read()
        if not ok:
            break
        col = fr[args.y0:args.y1, lx - 3:lx + 4, :].mean(axis=1).astype(np.uint8)
        cols.append(col)
    cap.release()

    img = np.stack(cols, axis=1)          # (height, time, 3)
    h, w = img.shape[:2]
    # shrink height to 400 px, keep time at 1 px/frame
    img = cv2.resize(img, (w, 400))

    # bottom ruler with minute marks + events
    bar = np.full((60, w, 3), 30, np.uint8)
    for f in range(f0, f1):
        t = f / fps
        if abs(t % 60) < 1 / fps:
            x = f - f0
            cv2.line(bar, (x, 0), (x, 20), (255, 255, 255), 1)
            cv2.putText(bar, f"{int(t//60)}m", (x + 3, 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    if args.events:
        for line in open(args.events, encoding="utf-8"):
            ev = legacy.event(json.loads(line))
            if f0 <= ev["video_frame"] < f1:
                x = ev["video_frame"] - f0
                color = COLORS.get(ev["category"], (255, 255, 255))
                pts = np.array([[x - 5, 58], [x + 5, 58], [x, 42]])
                cv2.fillPoly(bar, [pts], color)

    out = np.vstack([img, bar])
    cv2.imwrite(args.output, out)
    print(f"{args.output}  ({w}px = {(f1-f0)/fps:.0f}s)  legend: "
          "green=cyc yellow=ped orange=car blue=mot")


if __name__ == "__main__":
    main()
