#!/usr/bin/env python3
"""
Extracts one snapshot per blob from count_scanline.py (frame in the middle
of the blob, with the line and a circle at the blob's y position) and builds
grids.

Usage:
    python evaluation/snapshot_blobs.py evaluation/videos/Andradas_07.mp4 \
        evaluation/diag_07/blobs_10to13.json --output evaluation/diag_07/blobsnap
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config
import legacy


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("blobs_json")
    p.add_argument("--output", required=True)
    p.add_argument("--ncol", type=int, default=4)
    p.add_argument("--cw", type=int, default=480)
    args = p.parse_args()

    blobs = legacy.load_blobs(Path(args.blobs_json))
    outdir = Path(args.output)
    outdir.mkdir(parents=True, exist_ok=True)

    from exact_frames import exact_frames

    target_by_frame: dict[int, list] = {}
    for i, b in enumerate(blobs):
        f = b["frame"] + b["dur_frames"] // 2
        target_by_frame.setdefault(f, []).append((i, b))

    cells_by_i = {}
    ch = args.cw * 9 // 16
    for f, fr in exact_frames(args.video, list(target_by_frame)):
        for i, b in target_by_frame[f]:
            img_full = fr.copy()
            cv2.line(img_full, (config.LINE_X, 0),
                     (config.LINE_X, img_full.shape[0]), (0, 0, 255), 2)
            cv2.circle(img_full, (config.LINE_X, b["y_center"]), 60,
                       (0, 255, 0), 3)
            img = cv2.resize(img_full, (args.cw, ch))
            cv2.putText(img, f"blob{i:02d} t={b['t_s']}s y={b['y_center']} "
                             f"dur={b['dur_frames']}f",
                        (4, ch - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        (0, 255, 255), 1)
            cv2.rectangle(img, (0, 0), (args.cw - 1, ch - 1), (80, 80, 80), 1)
            cells_by_i[i] = img
    cells = [cells_by_i[i] for i in sorted(cells_by_i)]

    per_grid = args.ncol * 5
    for g in range(0, len(cells), per_grid):
        block = cells[g:g + per_grid]
        nrows = (len(block) + args.ncol - 1) // args.ncol
        grid = np.zeros((nrows * ch, args.ncol * args.cw, 3), np.uint8)
        for i, img in enumerate(block):
            r, c = divmod(i, args.ncol)
            grid[r * ch:(r + 1) * ch, c * args.cw:(c + 1) * args.cw] = img
        out = outdir / f"grid_{g//per_grid:02d}.png"
        cv2.imwrite(str(out), grid)
        print(out)


if __name__ == "__main__":
    main()
