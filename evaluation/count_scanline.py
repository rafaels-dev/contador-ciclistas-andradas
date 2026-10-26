#!/usr/bin/env python3
"""
Independent crossing counter based on background subtraction on the
counting-line column (no ML). Serves as a cross-check for the YOLO counter.

Method: extract the column x=LINE_X of every frame → image (y, t). Background =
sliding per-pixel temporal median. Foreground = |col - background| > thr.
Connected components on the (y, t) plane = one crossing each (approximately).

Filters out small components (noise) and reports a list (t_s, y_center, area,
dur_frames, height_px) + totals per y band.

Usage:
    python evaluation/count_scanline.py evaluation/videos/Andradas_07.mp4 \
        --start 0 --end 3600 --json evaluation/diag_07/scan_blobs.json
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--start", type=float, default=0, help="seconds")
    p.add_argument("--end", type=float, required=True, help="seconds")
    p.add_argument("--y0", type=int, default=250)
    p.add_argument("--y1", type=int, default=1080)
    p.add_argument("--thr", type=float, default=28)
    p.add_argument("--min-area", type=int, default=350,
                   help="minimum blob area in px*frames")
    p.add_argument("--min-height", type=int, default=40,
                   help="minimum blob height in px")
    p.add_argument("--json", required=True)
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
        col = fr[args.y0:args.y1, lx - 2:lx + 3, :].mean(axis=(1, 2))
        cols.append(col.astype(np.float32))
    cap.release()

    M = np.stack(cols, axis=1)            # (height, time)
    # background: sliding median over 40 s windows (robust to lighting changes)
    T = M.shape[1]
    win = int(40 * fps)
    fg = np.zeros_like(M, dtype=np.uint8)
    for a in range(0, T, win):
        b = min(a + win, T)
        bg = np.median(M[:, a:b], axis=1, keepdims=True)
        fg[:, a:b] = (np.abs(M[:, a:b] - bg) > args.thr).astype(np.uint8)

    # morphological cleanup: close holes (tall kernel in y to join parts of
    # the same object — wheels/body — and short in t so consecutive objects
    # are not joined), then remove specks
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((61, 7), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    ncomp, labels, stats, cents = cv2.connectedComponentsWithStats(fg, 8)
    blobs = []
    for i in range(1, ncomp):
        x, y, w, h, area = stats[i]   # x=time, y=height (transposed from the usual)
        # stats: [left(t), top(y)... careful: the image is (y, t) → left is t
        if area < args.min_area or stats[i, 3] < args.min_height:
            continue
        t_start = stats[i, 0]         # first column = relative frame
        dur = stats[i, 2]
        y_c = float(cents[i][1]) + args.y0
        blobs.append({
            "t_s": round(args.start + t_start / fps, 1),
            "frame": f0 + int(t_start),
            "dur_frames": int(dur),
            "y_center": round(y_c),
            "height_px": int(stats[i, 3]),
            "area": int(area),
        })

    blobs.sort(key=lambda b: b["t_s"])
    Path(args.json).write_text(json.dumps(blobs, indent=1))
    print(f"{len(blobs)} blobs (candidate crossings) in "
          f"{args.end - args.start:.0f}s → {args.json}")
    # summary per y band
    bands = {"street (250-900)": 0, "bike lane (900-1080)": 0}
    for b in blobs:
        if b["y_center"] < 900:
            bands["street (250-900)"] += 1
        else:
            bands["bike lane (900-1080)"] += 1
    print(bands)


if __name__ == "__main__":
    main()
