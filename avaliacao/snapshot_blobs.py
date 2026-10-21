#!/usr/bin/env python3
"""
Extrai um snapshot por blob do contar_scanline.py (frame no meio do blob,
com a linha e um círculo na posição y do blob) e monta grades.

Uso:
    python avaliacao/snapshot_blobs.py avaliacao/videos/Andradas_07.mp4 \
        avaliacao/diag_07/blobs_10a13.json --saida avaliacao/diag_07/blobsnap
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
    p.add_argument("blobs_json")
    p.add_argument("--saida", required=True)
    p.add_argument("--ncol", type=int, default=4)
    p.add_argument("--cw", type=int, default=480)
    args = p.parse_args()

    blobs = json.loads(Path(args.blobs_json).read_text())
    outdir = Path(args.saida)
    outdir.mkdir(parents=True, exist_ok=True)

    from frames_exatos import frames_exatos

    alvo_por_frame: dict[int, list] = {}
    for i, b in enumerate(blobs):
        f = b["frame"] + b["dur_frames"] // 2
        alvo_por_frame.setdefault(f, []).append((i, b))

    cells_por_i = {}
    ch = args.cw * 9 // 16
    for f, fr in frames_exatos(args.video, list(alvo_por_frame)):
        for i, b in alvo_por_frame[f]:
            img_full = fr.copy()
            cv2.line(img_full, (config.LINHA_X, 0),
                     (config.LINHA_X, img_full.shape[0]), (0, 0, 255), 2)
            cv2.circle(img_full, (config.LINHA_X, b["y_centro"]), 60,
                       (0, 255, 0), 3)
            img = cv2.resize(img_full, (args.cw, ch))
            cv2.putText(img, f"blob{i:02d} t={b['t_s']}s y={b['y_centro']} "
                             f"dur={b['dur_frames']}f",
                        (4, ch - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        (0, 255, 255), 1)
            cv2.rectangle(img, (0, 0), (args.cw - 1, ch - 1), (80, 80, 80), 1)
            cells_por_i[i] = img
    cells = [cells_por_i[i] for i in sorted(cells_por_i)]

    por_grade = args.ncol * 5
    for g in range(0, len(cells), por_grade):
        bloco = cells[g:g + por_grade]
        nlin = (len(bloco) + args.ncol - 1) // args.ncol
        grade = np.zeros((nlin * ch, args.ncol * args.cw, 3), np.uint8)
        for i, img in enumerate(bloco):
            r, c = divmod(i, args.ncol)
            grade[r * ch:(r + 1) * ch, c * args.cw:(c + 1) * args.cw] = img
        out = outdir / f"grade_{g//por_grade:02d}.png"
        cv2.imwrite(str(out), grade)
        print(out)


if __name__ == "__main__":
    main()
