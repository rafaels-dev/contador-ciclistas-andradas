#!/usr/bin/env python3
"""
Builds grids (contact sheets) of event snapshots for visual verification.

Each cell shows the downscaled snapshot with its label (category, tid,
reason, frame). Writes PNGs of up to nrows×ncol cells to <dir>/grids/.

Usage: python evaluation/build_grid.py evaluation/diag_07 [--cat cyclists] [--ncol 4] [--nrows 5]
"""
import argparse
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("dir")
    p.add_argument("--cat", default=None, help="filter by category")
    p.add_argument("--ncol", type=int, default=4)
    p.add_argument("--nrows", type=int, default=5)
    p.add_argument("--cw", type=int, default=480, help="cell width")
    args = p.parse_args()

    d = Path(args.dir)
    snaps = sorted((d / "snapshots").glob("*.jpg"))
    if args.cat:
        snaps = [s for s in snaps if s.name.startswith(args.cat)]
    if not snaps:
        print("no snapshots")
        return

    ch = args.cw * 9 // 16
    per_grid = args.ncol * args.nrows
    outdir = d / "grids"
    outdir.mkdir(exist_ok=True)

    for g in range(0, len(snaps), per_grid):
        block = snaps[g:g + per_grid]
        grid = np.zeros((args.nrows * ch, args.ncol * args.cw, 3), np.uint8)
        for i, s in enumerate(block):
            img = cv2.imread(str(s))
            img = cv2.resize(img, (args.cw, ch))
            cv2.rectangle(img, (0, 0), (args.cw - 1, ch - 1), (80, 80, 80), 1)
            cv2.putText(img, s.stem, (4, ch - 6), cv2.FONT_HERSHEY_SIMPLEX,
                        0.42, (0, 255, 255), 1)
            r, c = divmod(i, args.ncol)
            grid[r * ch:(r + 1) * ch, c * args.cw:(c + 1) * args.cw] = img
        prefix = (args.cat or "all")
        out = outdir / f"grid_{prefix}_{g//per_grid:02d}.png"
        cv2.imwrite(str(out), grid)
        print(out, f"({len(block)} events)")


if __name__ == "__main__":
    main()
