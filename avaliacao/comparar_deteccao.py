#!/usr/bin/env python3
"""
Compara configurações de detecção (modelo, imgsz, conf) em frames amostrados
de um vídeo. Reporta média de detecções por frame por classe COCO relevante.

Uso:
    python avaliacao/comparar_deteccao.py avaliacao/videos/Andradas_21.mp4 --n 120
"""
import argparse
import json
from collections import defaultdict

import cv2
from ultralytics import YOLO

CLASSES = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

CONFIGS = [
    ("yolov8n.pt", 640, 0.40),   # atual
    ("yolov8n.pt", 1280, 0.40),
    ("yolov8n.pt", 1280, 0.25),
    ("yolov8s.pt", 1280, 0.40),
    ("yolov8s.pt", 1280, 0.25),
    ("yolov8m.pt", 1280, 0.25),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--n", type=int, default=120)
    args = p.parse_args()

    cap = cv2.VideoCapture(args.video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    idxs = [int(i * total / args.n) for i in range(args.n)]
    frames = []
    for ix in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, ix)
        ok, fr = cap.read()
        if ok:
            frames.append(fr)
    cap.release()
    print(f"{len(frames)} frames amostrados de {args.video}")

    resultados = {}
    for modelo, imgsz, conf in CONFIGS:
        m = YOLO(modelo)
        cont = defaultdict(int)
        import time
        t0 = time.time()
        for fr in frames:
            r = m(fr, conf=conf, imgsz=imgsz, classes=list(CLASSES),
                  verbose=False)[0]
            for c in r.boxes.cls.tolist():
                cont[CLASSES[int(c)]] += 1
        dt = (time.time() - t0) / len(frames) * 1000
        chave = f"{modelo}@{imgsz} conf={conf}"
        resultados[chave] = {"ms_por_frame": round(dt, 1),
                             **{k: round(v / len(frames), 3)
                                for k, v in sorted(cont.items())}}
        print(chave, json.dumps(resultados[chave]))

    print(json.dumps(resultados, indent=2))


if __name__ == "__main__":
    main()
