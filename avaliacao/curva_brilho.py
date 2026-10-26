#!/usr/bin/env python3
"""
Curva de brilho por minuto de cada vídeo (decodificação sequencial —
imune ao erro de seek do DVR). Também salva um thumbnail por marco de
10 minutos para inspeção visual.

Uso: python avaliacao/curva_brilho.py avaliacao/videos/Andradas_21.mp4 --saida avaliacao/brilho
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("videos", nargs="+")
    p.add_argument("--saida", required=True)
    p.add_argument("--passo", type=int, default=30, help="analisa 1 a cada N frames")
    args = p.parse_args()
    out = Path(args.saida)
    out.mkdir(parents=True, exist_ok=True)

    for v in args.videos:
        nome = Path(v).stem
        cap = cv2.VideoCapture(v)
        fps = cap.get(cv2.CAP_PROP_FPS)
        brilho = []          # (frame, brilho médio, saturação média)
        i = 0
        while True:
            if not cap.grab():
                break
            if i % args.passo == 0:
                ok, fr = cap.retrieve()
                if ok:
                    peq = cv2.resize(fr, (320, 180))
                    hsv = cv2.cvtColor(peq, cv2.COLOR_BGR2HSV)
                    brilho.append((i, round(float(hsv[..., 2].mean()), 1),
                                   round(float(hsv[..., 1].mean()), 1)))
                    if i % int(600 * fps) < args.passo:  # a cada ~10 min
                        cv2.imwrite(str(out / f"{nome}_m{int(i/fps/60):02d}.jpg"),
                                    cv2.resize(fr, (640, 360)),
                                    [cv2.IMWRITE_JPEG_QUALITY, 80])
            i += 1
        cap.release()

        # agrega por minuto
        por_min = {}
        for f, b, s in brilho:
            m = int(f / fps / 60)
            por_min.setdefault(m, []).append((b, s))
        resumo = {m: {"brilho": round(np.mean([x[0] for x in xs]), 1),
                      "saturacao": round(np.mean([x[1] for x in xs]), 1)}
                  for m, xs in sorted(por_min.items())}
        (out / f"{nome}.json").write_text(json.dumps(resumo, indent=1))
        bs = [r["brilho"] for r in resumo.values()]
        print(f"{nome}: brilho min={min(bs)} max={max(bs)} "
              f"primeiro={bs[0]} ultimo={bs[-1]}")


if __name__ == "__main__":
    main()
