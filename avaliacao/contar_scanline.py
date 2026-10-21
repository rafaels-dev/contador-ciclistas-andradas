#!/usr/bin/env python3
"""
Contador independente de cruzamentos por subtração de fundo na coluna da
linha de contagem (sem ML). Serve de cross-check para o contador YOLO.

Método: extrai a coluna x=LINHA_X de cada frame → imagem (y, t). Fundo =
mediana temporal deslizante por pixel. Foreground = |col - fundo| > thr.
Componentes conexos no plano (y, t) = um cruzamento cada (aproximado).

Filtra componentes pequenos (ruído) e reporta lista (t_s, y_centro, área,
duração_frames, altura_px) + total por faixa de y.

Uso:
    python avaliacao/contar_scanline.py avaliacao/videos/Andradas_07.mp4 \
        --inicio 0 --fim 3600 --json avaliacao/diag_07/scan_blobs.json
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
    p.add_argument("--inicio", type=float, default=0)
    p.add_argument("--fim", type=float, required=True)
    p.add_argument("--y0", type=int, default=250)
    p.add_argument("--y1", type=int, default=1080)
    p.add_argument("--thr", type=float, default=28)
    p.add_argument("--area-min", type=int, default=350,
                   help="área mínima do blob em px*frames")
    p.add_argument("--altura-min", type=int, default=40,
                   help="altura mínima do blob em px")
    p.add_argument("--json", required=True)
    args = p.parse_args()

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    f0, f1 = int(args.inicio * fps), int(args.fim * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, f0)

    lx = config.LINHA_X
    cols = []
    for f in range(f0, f1):
        ok, fr = cap.read()
        if not ok:
            break
        col = fr[args.y0:args.y1, lx - 2:lx + 3, :].mean(axis=(1, 2))
        cols.append(col.astype(np.float32))
    cap.release()

    M = np.stack(cols, axis=1)            # (altura, tempo)
    # fundo: mediana deslizante por janelas de 40s (estável a mudanças de luz)
    T = M.shape[1]
    win = int(40 * fps)
    fg = np.zeros_like(M, dtype=np.uint8)
    for a in range(0, T, win):
        b = min(a + win, T)
        bg = np.median(M[:, a:b], axis=1, keepdims=True)
        fg[:, a:b] = (np.abs(M[:, a:b] - bg) > args.thr).astype(np.uint8)

    # limpeza morfológica: fecha buracos (kernel alto em y para unir partes
    # do mesmo objeto — rodas/corpo — e curto em t para não unir objetos
    # consecutivos), depois remove pontinhos
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((61, 7), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    ncomp, labels, stats, cents = cv2.connectedComponentsWithStats(fg, 8)
    blobs = []
    for i in range(1, ncomp):
        x, y, w, h, area = stats[i]   # x=tempo, y=altura (transposto do usual)
        # stats: [left(t), top(y)... cuidado: imagem é (y, t) → left é t
        if area < args.area_min or stats[i, 3] < args.altura_min:
            continue
        t_ini = stats[i, 0]           # coluna inicial = frame relativo
        dur = stats[i, 2]
        y_c = float(cents[i][1]) + args.y0
        blobs.append({
            "t_s": round(args.inicio + t_ini / fps, 1),
            "frame": f0 + int(t_ini),
            "dur_frames": int(dur),
            "y_centro": round(y_c),
            "altura_px": int(stats[i, 3]),
            "area": int(area),
        })

    blobs.sort(key=lambda b: b["t_s"])
    Path(args.json).write_text(json.dumps(blobs, indent=1))
    print(f"{len(blobs)} blobs (cruzamentos candidatos) em "
          f"{args.fim - args.inicio:.0f}s → {args.json}")
    # resumo por faixa de y
    faixas = {"rua (250-900)": 0, "ciclovia (900-1080)": 0}
    for b in blobs:
        if b["y_centro"] < 900:
            faixas["rua (250-900)"] += 1
        else:
            faixas["ciclovia (900-1080)"] += 1
    print(faixas)


if __name__ == "__main__":
    main()
