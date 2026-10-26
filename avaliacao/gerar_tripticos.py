#!/usr/bin/env python3
"""
Para cada candidato minerado, gera um TRÍPTICO para classificação por LLM:
3 frames (t-1s, t, t+1s) em 480x270 lado a lado + zoom 2x da região
candidata no frame central. Grades de 4 trípticos por imagem.

Saída: avaliacao/mineracao/tripticos/grade_XX.png
       avaliacao/mineracao/tripticos/mapa.json  (grade/posição → id)
"""
import json
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent
FPS = 14.874455802535433
DELTA = 15   # ~1 s


def compor_triptico(frames3, c):
    paineis = [cv2.resize(f, (480, 270)) for f in frames3]
    topo = np.hstack(paineis)
    # zoom 2x na região candidata (frame central, resolução cheia)
    fr = frames3[1]
    if c.get("box"):
        cx = int((c["box"][0] + c["box"][2]) / 2)
        cy = int((c["box"][1] + c["box"][3]) / 2)
    else:
        cx, cy = 960, int(c.get("y", 700))
    x1, y1 = max(0, cx - 240), max(0, cy - 135)
    x2, y2 = min(fr.shape[1], x1 + 480), min(fr.shape[0], y1 + 270)
    zoom = cv2.resize(fr[y1:y2, x1:x2], (960, 540))
    rotulo = np.full((540, 480, 3), 25, np.uint8)
    cv2.putText(rotulo, c["id"], (20, 90), cv2.FONT_HERSHEY_SIMPLEX,
                1.6, (0, 255, 255), 3)
    cv2.putText(rotulo, f"hora {c['hora']}", (20, 160),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (200, 200, 200), 2)
    cv2.putText(rotulo, f"t={c['tempo_s']}s", (20, 220),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (200, 200, 200), 2)
    base = np.hstack([rotulo, zoom])
    trip = np.vstack([topo, base])
    cv2.rectangle(trip, (0, 0), (trip.shape[1] - 1, trip.shape[0] - 1),
                  (90, 90, 90), 2)
    return trip   # 1440 x 810


def main():
    cands = json.loads((RAIZ / "mineracao/candidatos.json").read_text())
    out = RAIZ / "mineracao/tripticos"
    out.mkdir(parents=True, exist_ok=True)

    por_hora = {}
    for c in cands:
        por_hora.setdefault(c["hora"], []).append(c)

    trips = {}
    for hora, lista in sorted(por_hora.items()):
        video = str(RAIZ / f"videos/Andradas_{hora}.mp4")
        pedidos = {}
        for c in lista:
            for f in (c["frame"] - DELTA, c["frame"], c["frame"] + DELTA):
                pedidos.setdefault(max(0, f), []).append(c["id"])
        got = {}
        cap = cv2.VideoCapture(video)
        alvos = sorted(pedidos)
        ai = 0
        i = 0
        while ai < len(alvos):
            ok, fr = cap.read()
            if not ok:
                break
            if i == alvos[ai]:
                got[i] = fr.copy()
                ai += 1
            i += 1
        cap.release()
        for c in lista:
            f3 = [got.get(max(0, c["frame"] + d))
                  for d in (-DELTA, 0, DELTA)]
            if any(x is None for x in f3):
                continue
            trips[c["id"]] = compor_triptico(f3, c)
        print(f"[{hora}] {len(lista)} tripticos", flush=True)

    # grades de 4 (2x2), meia escala → 1440x810
    ids = sorted(trips)
    mapa = {}
    for g in range(0, len(ids), 4):
        bloco = ids[g:g + 4]
        cel = [cv2.resize(trips[i], (720, 405)) for i in bloco]
        while len(cel) < 4:
            cel.append(np.zeros((405, 720, 3), np.uint8))
        grade = np.vstack([np.hstack(cel[:2]), np.hstack(cel[2:])])
        nome = f"grade_{g//4:03d}.png"
        cv2.imwrite(str(out / nome), grade)
        mapa[nome] = bloco
    (out / "mapa.json").write_text(json.dumps(mapa, indent=1))
    print(f"{len(ids)} tripticos em {len(mapa)} grades", flush=True)


if __name__ == "__main__":
    main()
