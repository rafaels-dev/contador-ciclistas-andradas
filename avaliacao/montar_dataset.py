#!/usr/bin/env python3
"""
Monta dataset de fine-tuning a partir dos vídeos desta câmera:

1. Seleciona frames das horas diurnas (com bicicletas/motos garantidas nos
   frames de eventos + aleatórios para fundo/carros).
2. Auto-rotula com yolov8x @1280 (alta qualidade).
3. Gera versão aumentada com MOTION BLUR direcional aplicado só dentro das
   caixas de objetos móveis (simula o borrão noturno com fundo nítido).

Classes remapeadas: person→0 bicycle→1 car→2 motorcycle→3 bus→4 truck→5

Saída (formato YOLO): avaliacao/dataset/{images,labels}/{train,val}/ + data.yaml
"""
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames_exatos import frames_exatos

random.seed(42)

RAIZ = Path(__file__).resolve().parent
HORAS_TREINO = ["06", "08", "09", "10", "11", "13", "14", "15", "16"]
REMAP = {0: 0, 1: 1, 2: 2, 3: 3, 5: 4, 7: 5}
NOMES = ["person", "bicycle", "car", "motorcycle", "bus", "truck"]


def escolher_frames(hora: str) -> list[int]:
    evs = [json.loads(l) for l in
           open(RAIZ / f"varredura_v9/diag_{hora}/eventos.jsonl")]
    frames = set()
    cic = [e["frame_video"] for e in evs if e["categoria"] == "ciclistas"]
    mot = [e["frame_video"] for e in evs if e["categoria"] == "motocicletas"]
    ped = [e["frame_video"] for e in evs if e["categoria"] == "pedestres"]
    for f in cic:                                 # todos os frames com bike
        frames.update([f - 8, f, f + 8])
    for f in random.sample(mot, min(70, len(mot))):
        frames.update([f - 6, f])
    for f in random.sample(ped, min(15, len(ped))):
        frames.add(f)
    frames.update(random.sample(range(500, 53000), 25))   # fundo/carros
    return sorted(f for f in frames if 0 < f < 53500)


def blur_direcional(img, boxes, ksize):
    """Aplica motion blur horizontal dentro das caixas (com margem)."""
    k = np.zeros((ksize, ksize), np.float32)
    k[ksize // 2, :] = 1.0 / ksize
    sai = img.copy()
    for (x1, y1, x2, y2) in boxes:
        m = 12
        x1, y1 = max(0, int(x1) - m), max(0, int(y1) - m)
        x2, y2 = min(img.shape[1], int(x2) + m), min(img.shape[0], int(y2) + m)
        if x2 - x1 < 8 or y2 - y1 < 8:
            continue
        sai[y1:y2, x1:x2] = cv2.filter2D(img[y1:y2, x1:x2], -1, k)
    return sai


HORAS_NOITE = ["19", "20", "21", "22", "23"]


def escolher_frames_noite(hora: str) -> list[int]:
    """Frames noturnos: eventos de pedestres/carros (objetos nítidos à
    noite) + aleatórios — ensinam o domínio escuro sem rotular blur."""
    evs = [json.loads(l) for l in
           open(RAIZ / f"varredura_v9/diag_{hora}/eventos.jsonl")]
    frames = set()
    ped = [e["frame_video"] for e in evs if e["categoria"] == "pedestres"]
    aut = [e["frame_video"] for e in evs if e["categoria"] == "automoveis"]
    for f in random.sample(ped, min(20, len(ped))):
        frames.add(f)
    for f in random.sample(aut, min(12, len(aut))):
        frames.add(f)
    frames.update(random.sample(range(500, 53000), 8))
    return sorted(f for f in frames if 0 < f < 53500)


def main():
    out = RAIZ / "dataset"
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    modelo = YOLO("yolov8x.pt")
    n_img = 0
    for hora in HORAS_TREINO:
        video = RAIZ / f"videos/Andradas_{hora}.mp4"
        alvos = escolher_frames(hora)
        print(f"[{hora}] {len(alvos)} frames", flush=True)
        for idx, fr in frames_exatos(str(video), alvos):
            r = modelo(fr, conf=0.40, imgsz=1280, classes=list(REMAP),
                       agnostic_nms=True, verbose=False)[0]
            if len(r.boxes) == 0:
                continue
            h, w = fr.shape[:2]
            linhas, caixas_moveis = [], []
            for b in r.boxes:
                cls = REMAP[int(b.cls[0])]
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                cxn, cyn = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
                wn, hn = (x2 - x1) / w, (y2 - y1) / h
                linhas.append(f"{cls} {cxn:.5f} {cyn:.5f} {wn:.5f} {hn:.5f}")
                caixas_moveis.append((x1, y1, x2, y2))
            split = "val" if random.random() < 0.12 else "train"
            nome = f"{hora}_{idx:06d}"
            cv2.imwrite(str(out / f"images/{split}/{nome}.jpg"), fr,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out / f"labels/{split}/{nome}.txt").write_text("\n".join(linhas))
            n_img += 1

            # versão com blur sintético (só treino)
            if split == "train":
                ksize = random.choice([13, 19, 25, 31, 37])
                fb = blur_direcional(fr, caixas_moveis, ksize)
                cv2.imwrite(str(out / f"images/train/{nome}_blur.jpg"), fb,
                            [cv2.IMWRITE_JPEG_QUALITY, 92])
                (out / f"labels/train/{nome}_blur.txt").write_text(
                    "\n".join(linhas))
                n_img += 1
        print(f"[{hora}] acumulado: {n_img} imagens", flush=True)

    # frames noturnos (rotulados com conf mais alta; sem blur sintético —
    # o blur real da noite já está nos objetos rápidos, que ficam SEM
    # rótulo e portanto não ensinam nada errado)
    for hora in HORAS_NOITE:
        video = RAIZ / f"videos/Andradas_{hora}.mp4"
        alvos = escolher_frames_noite(hora)
        print(f"[noite {hora}] {len(alvos)} frames", flush=True)
        for idx, fr in frames_exatos(str(video), alvos):
            r = modelo(fr, conf=0.50, imgsz=1280, classes=list(REMAP),
                       agnostic_nms=True, verbose=False)[0]
            h, w = fr.shape[:2]
            linhas = []
            for b in r.boxes:
                cls = REMAP[int(b.cls[0])]
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                linhas.append(f"{cls} {(x1+x2)/2/w:.5f} {(y1+y2)/2/h:.5f} "
                              f"{(x2-x1)/w:.5f} {(y2-y1)/h:.5f}")
            # inclui também frames noturnos SEM objetos (negativos)
            split = "val" if random.random() < 0.12 else "train"
            nome = f"n{hora}_{idx:06d}"
            cv2.imwrite(str(out / f"images/{split}/{nome}.jpg"), fr,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out / f"labels/{split}/{nome}.txt").write_text("\n".join(linhas))
            n_img += 1

    (out / "data.yaml").write_text(
        f"path: {out}\ntrain: images/train\nval: images/val\n"
        f"names:\n" + "\n".join(f"  {i}: {n}" for i, n in enumerate(NOMES)) + "\n")
    print(f"dataset pronto: {n_img} imagens em {out}", flush=True)


if __name__ == "__main__":
    main()
