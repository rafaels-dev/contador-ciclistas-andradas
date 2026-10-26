#!/usr/bin/env python3
"""
Monta grades (contact sheets) de snapshots de eventos para verificação visual.

Cada célula mostra o snapshot reduzido com o rótulo (categoria, tid, motivo,
frame). Gera PNGs de até nlin×ncol células em <dir>/grades/.

Uso: python avaliacao/montar_grade.py avaliacao/diag_07 [--cat ciclistas] [--ncol 4] [--nlin 5]
"""
import argparse
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("dir")
    p.add_argument("--cat", default=None, help="filtra por categoria")
    p.add_argument("--ncol", type=int, default=4)
    p.add_argument("--nlin", type=int, default=5)
    p.add_argument("--cw", type=int, default=480, help="largura da célula")
    args = p.parse_args()

    d = Path(args.dir)
    snaps = sorted((d / "snapshots").glob("*.jpg"))
    if args.cat:
        snaps = [s for s in snaps if s.name.startswith(args.cat)]
    if not snaps:
        print("nenhum snapshot")
        return

    ch = args.cw * 9 // 16
    por_grade = args.ncol * args.nlin
    outdir = d / "grades"
    outdir.mkdir(exist_ok=True)

    for g in range(0, len(snaps), por_grade):
        bloco = snaps[g:g + por_grade]
        grade = np.zeros((args.nlin * ch, args.ncol * args.cw, 3), np.uint8)
        for i, s in enumerate(bloco):
            img = cv2.imread(str(s))
            img = cv2.resize(img, (args.cw, ch))
            cv2.rectangle(img, (0, 0), (args.cw - 1, ch - 1), (80, 80, 80), 1)
            cv2.putText(img, s.stem, (4, ch - 6), cv2.FONT_HERSHEY_SIMPLEX,
                        0.42, (0, 255, 255), 1)
            r, c = divmod(i, args.ncol)
            grade[r * ch:(r + 1) * ch, c * args.cw:(c + 1) * args.cw] = img
        pref = (args.cat or "todos")
        out = outdir / f"grade_{pref}_{g//por_grade:02d}.png"
        cv2.imwrite(str(out), grade)
        print(out, f"({len(bloco)} eventos)")


if __name__ == "__main__":
    main()
