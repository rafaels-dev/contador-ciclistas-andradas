#!/usr/bin/env python3
"""
Runner de diagnóstico: roda o ContadorVeiculos num vídeo e grava:

  - eventos.jsonl : cada contagem com frame, categoria, direção, motivo
                    (entrada/centroide/reid_oposto), tid, bbox e cx
  - tracks.json   : trajetória resumida de cada track (primeiro/último frame,
                    cx inicial/final/min/max) — para detectar contagens
                    indevidas e cruzamentos perdidos
  - resumo.json   : totais por categoria/direção/motivo
  - snapshots/    : JPG anotado de cada evento de contagem (amostrado)

Uso:
    python avaliacao/rodar_instrumentado.py --video avaliacao/videos/Andradas_07.mp4 \
        --saida avaliacao/diag_07 [--inicio 0] [--fim 600] [--max-snapshots 300]
"""
import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from contador import ContadorVeiculos

CATS = ["ciclistas", "pedestres", "automoveis", "motocicletas"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--saida", required=True)
    p.add_argument("--inicio", type=float, default=0)
    p.add_argument("--fim", type=float, default=None)
    p.add_argument("--max-snapshots", type=int, default=300,
                   help="máximo de snapshots POR CATEGORIA")
    p.add_argument("--modelo", default=None)
    p.add_argument("--conf", type=float, default=None)
    p.add_argument("--imgsz", type=int, default=None)
    args = p.parse_args()

    saida = Path(args.saida)
    (saida / "snapshots").mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"não abriu {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    f_ini = int(args.inicio * fps)
    f_fim = int(args.fim * fps) if args.fim else n_frames
    if f_ini:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_ini)

    kw = {}
    if args.modelo:
        kw["modelo"] = args.modelo
    if args.conf:
        kw["confianca"] = args.conf
    if args.imgsz:
        kw["imgsz"] = args.imgsz
    contador = ContadorVeiculos(**kw)

    # (cat, tid) -> resumo da trajetória
    tracks: dict = {}
    eventos_out = open(saida / "eventos.jsonl", "w")
    n_eventos_vistos = {c: 0 for c in CATS}
    n_snapshots = {c: 0 for c in CATS}

    frame_i = f_ini
    t0 = time.time()
    while frame_i < f_fim:
        ok, frame = cap.read()
        if not ok:
            break
        r = contador.processar(frame)

        dets_por_cat = {
            "ciclistas": r.ciclistas, "pedestres": r.pedestres,
            "automoveis": r.automoveis, "motocicletas": r.motocicletas,
        }

        # trajetórias
        for cat, det in dets_por_cat.items():
            if len(det) == 0 or det.tracker_id is None:
                continue
            for k, tid in enumerate(det.tracker_id):
                cx = float((det.xyxy[k, 0] + det.xyxy[k, 2]) / 2)
                cy = float((det.xyxy[k, 1] + det.xyxy[k, 3]) / 2)
                key = (cat, int(tid))
                t = tracks.get(key)
                if t is None:
                    tracks[key] = {
                        "f0": frame_i, "f1": frame_i, "cx0": cx, "cx1": cx,
                        "cxmin": cx, "cxmax": cx, "cy1": cy, "n": 1,
                    }
                else:
                    t["f1"] = frame_i
                    t["cx1"] = cx
                    t["cy1"] = cy
                    t["cxmin"] = min(t["cxmin"], cx)
                    t["cxmax"] = max(t["cxmax"], cx)
                    t["n"] += 1

        # eventos novos desta iteração
        for cat, linha in contador.linhas.items():
            evs = linha.eventos
            while n_eventos_vistos[cat] < len(evs):
                ev = dict(evs[n_eventos_vistos[cat]])
                n_eventos_vistos[cat] += 1
                ev["categoria"] = cat
                ev["frame_video"] = frame_i
                ev["tempo_s"] = round(frame_i / fps, 2)
                det = dets_por_cat[cat]
                bbox = None
                if len(det) and det.tracker_id is not None:
                    hit = np.where(det.tracker_id == ev["tid"])[0]
                    if len(hit):
                        bbox = [round(float(v), 1) for v in det.xyxy[hit[0]]]
                ev["bbox"] = bbox
                eventos_out.write(json.dumps(ev, ensure_ascii=False) + "\n")

                if n_snapshots[cat] < args.max_snapshots:
                    n_snapshots[cat] += 1
                    img = frame.copy()
                    cv2.line(img, (config.LINHA_X, 0), (config.LINHA_X, img.shape[0]),
                             (0, 0, 255), 2)
                    if bbox:
                        x1, y1, x2, y2 = [int(v) for v in bbox]
                        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 3)
                    label = f"{cat} tid={ev['tid']} {ev['motivo']} {ev['lado']} f={frame_i}"
                    cv2.putText(img, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX,
                                1.0, (0, 255, 255), 2)
                    img = cv2.resize(img, (960, 540))
                    nome = f"{cat}_{frame_i:06d}_tid{ev['tid']}_{ev['motivo']}.jpg"
                    cv2.imwrite(str(saida / "snapshots" / nome), img,
                                [cv2.IMWRITE_JPEG_QUALITY, 80])

        frame_i += 1
        if (frame_i - f_ini) % 900 == 0:
            el = time.time() - t0
            done = frame_i - f_ini
            print(f"[{done}/{f_fim - f_ini}] {done / el:.1f} fps  "
                  f"cic={r.total_ciclistas} ped={r.total_pedestres} "
                  f"aut={r.total_automoveis} mot={r.total_motocicletas}", flush=True)

    cap.release()
    eventos_out.close()

    r_final = r
    resumo = {
        "video": args.video,
        "frames": [f_ini, frame_i],
        "fps_processamento": round((frame_i - f_ini) / (time.time() - t0), 1),
        "totais": {
            "ciclistas": r_final.total_ciclistas,
            "pedestres": r_final.total_pedestres,
            "automoveis": r_final.total_automoveis,
            "motocicletas": r_final.total_motocicletas,
        },
        "direcoes": {
            "ciclistas": {"in": r_final.cic_in, "out": r_final.cic_out},
            "pedestres": {"in": r_final.ped_in, "out": r_final.ped_out},
            "automoveis": {"in": r_final.aut_in, "out": r_final.aut_out},
            "motocicletas": {"in": r_final.mot_in, "out": r_final.mot_out},
        },
        "por_motivo": {},
    }
    for cat, linha in contador.linhas.items():
        mot = defaultdict(int)
        for ev in linha.eventos:
            mot[ev["motivo"]] += 1
        resumo["por_motivo"][cat] = dict(mot)

    tracks_ser = [
        {"cat": cat, "tid": tid, **t} for (cat, tid), t in tracks.items()
    ]
    (saida / "tracks.json").write_text(json.dumps(tracks_ser))
    (saida / "resumo.json").write_text(json.dumps(resumo, indent=2, ensure_ascii=False))
    print(json.dumps(resumo, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
