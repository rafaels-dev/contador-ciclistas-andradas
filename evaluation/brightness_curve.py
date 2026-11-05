#!/usr/bin/env python3
"""
Per-minute brightness curve of each video (sequential decoding — immune to
the DVR seek error). Also saves one thumbnail per 10-minute mark for visual
inspection.

Usage: python evaluation/brightness_curve.py evaluation/videos/Andradas_21.mp4 --output evaluation/brightness
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("videos", nargs="+")
    p.add_argument("--output", required=True)
    p.add_argument("--step", type=int, default=30, help="analyze 1 out of every N frames")
    args = p.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    for v in args.videos:
        name = Path(v).stem
        cap = cv2.VideoCapture(v)
        fps = cap.get(cv2.CAP_PROP_FPS)
        samples = []          # (frame, mean brightness, mean saturation)
        i = 0
        while True:
            if not cap.grab():
                break
            if i % args.step == 0:
                ok, fr = cap.retrieve()
                if ok:
                    small = cv2.resize(fr, (320, 180))
                    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
                    samples.append((i, round(float(hsv[..., 2].mean()), 1),
                                    round(float(hsv[..., 1].mean()), 1)))
                    if i % int(600 * fps) < args.step:  # every ~10 min
                        cv2.imwrite(str(out / f"{name}_m{int(i/fps/60):02d}.jpg"),
                                    cv2.resize(fr, (640, 360)),
                                    [cv2.IMWRITE_JPEG_QUALITY, 80])
            i += 1
        cap.release()

        # aggregate per minute
        per_min = {}
        for f, b, s in samples:
            m = int(f / fps / 60)
            per_min.setdefault(m, []).append((b, s))
        summary = {m: {"brightness": round(np.mean([x[0] for x in xs]), 1),
                       "saturation": round(np.mean([x[1] for x in xs]), 1)}
                   for m, xs in sorted(per_min.items())}
        (out / f"{name}.json").write_text(json.dumps(summary, indent=1))
        bs = [r["brightness"] for r in summary.values()]
        print(f"{name}: brightness min={min(bs)} max={max(bs)} "
              f"first={bs[0]} last={bs[-1]}")


if __name__ == "__main__":
    main()
