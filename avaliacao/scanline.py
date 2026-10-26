#!/usr/bin/env python3
"""
Diagrama espaço-tempo da linha de contagem ("laço indutivo virtual").

Para cada frame, extrai a coluna de pixels em x = linha_x (média de uma
janela de ±3 px) e empilha as colunas no eixo do tempo. Cada objeto que
cruza a linha aparece como um borrão vertical — contável visualmente,
dando ground truth quase exato sem ML.

Gera 1 PNG por janela de tempo, com marcações de minuto e as contagens
do algoritmo (eventos.jsonl) sobrepostas como triângulos na base.

Uso:
    python avaliacao/scanline.py avaliacao/videos/Andradas_07.mp4 \
        --inicio 600 --fim 900 --eventos avaliacao/diag_07/eventos.jsonl \
        --saida avaliacao/diag_07/scan_10a15min.png
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config

CORES = {"ciclistas": (0, 255, 0), "pedestres": (0, 255, 255),
         "automoveis": (0, 128, 255), "motocicletas": (255, 128, 0)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--inicio", type=float, default=0, help="segundos")
    p.add_argument("--fim", type=float, required=True, help="segundos")
    p.add_argument("--eventos", default=None)
    p.add_argument("--saida", required=True)
    p.add_argument("--y0", type=int, default=250)
    p.add_argument("--y1", type=int, default=1080)
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
        col = fr[args.y0:args.y1, lx - 3:lx + 4, :].mean(axis=1).astype(np.uint8)
        cols.append(col)
    cap.release()

    img = np.stack(cols, axis=1)          # (altura, tempo, 3)
    h, w = img.shape[:2]
    # reduz altura para 400px, mantém tempo 1px/frame
    img = cv2.resize(img, (w, 400))

    # régua inferior com marcas de minuto + eventos
    barra = np.full((60, w, 3), 30, np.uint8)
    for f in range(f0, f1):
        t = f / fps
        if abs(t % 60) < 1 / fps:
            x = f - f0
            cv2.line(barra, (x, 0), (x, 20), (255, 255, 255), 1)
            cv2.putText(barra, f"{int(t//60)}m", (x + 3, 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    if args.eventos:
        for l in open(args.eventos):
            ev = json.loads(l)
            if f0 <= ev["frame_video"] < f1:
                x = ev["frame_video"] - f0
                cor = CORES.get(ev["categoria"], (255, 255, 255))
                pts = np.array([[x - 5, 58], [x + 5, 58], [x, 42]])
                cv2.fillPoly(barra, [pts], cor)

    out = np.vstack([img, barra])
    cv2.imwrite(args.saida, out)
    print(f"{args.saida}  ({w}px = {(f1-f0)/fps:.0f}s)  legenda: "
          "verde=cic amarelo=ped laranja=aut azul=mot")


if __name__ == "__main__":
    main()
