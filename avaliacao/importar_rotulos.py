#!/usr/bin/env python3
"""
Importa rotulos_andradas.json (exportado pelo app de rotulagem do
Cristiano) e converte os positivos de bicicleta em exemplos de treino:

  - para cada candidato rotulado "bicicleta", extrai o frame central em
    resolução cheia e tenta obter a CAIXA da bicicleta rodando o modelo FT
    em confiança mínima (0.01) e escolhendo a detecção bicycle mais
    próxima da posição candidata;
  - grava imagem+rótulo YOLO em avaliacao/dataset/images|labels/train
    (prefixo "cr_"), incluindo TODOS os objetos do frame rotulados pelo
    yolov8x (para não ensinar que os outros objetos são fundo);
  - candidatos "bicicleta" SEM caixa recuperável vão para
    avaliacao/mineracao/sem_caixa.json (rotular caixa manualmente depois).

Depois rode: python avaliacao/treinar_ft.py

Uso: python avaliacao/importar_rotulos.py caminho/rotulos_andradas.json
"""
import json
import sys
from pathlib import Path

import cv2
from ultralytics import YOLO

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames_exatos import frames_exatos

RAIZ = Path(__file__).resolve().parent
REMAP = {0: 0, 1: 1, 2: 2, 3: 3, 5: 4, 7: 5}


def main():
    rot_path = Path(sys.argv[1])
    rotulos = json.loads(rot_path.read_text())["rotulos"]
    cands = {c["id"]: c for c in
             json.loads((RAIZ / "mineracao/candidatos.json").read_text())}

    positivos = [cands[i] for i, l in rotulos.items()
                 if l == "bicicleta" and i in cands]
    print(f"{len(positivos)} candidatos rotulados como bicicleta")

    ft = YOLO(RAIZ.parent / "runs/ft_blur/weights/best.pt")
    x = YOLO("yolov8x.pt")
    out_img = RAIZ / "dataset/images/train"
    out_lbl = RAIZ / "dataset/labels/train"
    sem_caixa = []
    n_ok = 0

    por_hora = {}
    for c in positivos:
        por_hora.setdefault(c["hora"], []).append(c)

    for hora, lista in sorted(por_hora.items()):
        video = str(RAIZ / f"videos/Andradas_{hora}.mp4")
        alvo_por_frame = {c["frame"]: c for c in lista}
        for f, fr in frames_exatos(video, list(alvo_por_frame)):
            c = alvo_por_frame[f]
            h, w = fr.shape[:2]

            # caixa da bicicleta: modelo FT em conf mínima, mais próxima
            # da posição candidata
            r = ft(fr, conf=0.01, imgsz=640, classes=[1], verbose=False)[0]
            alvo_cx = ((c["box"][0] + c["box"][2]) / 2 if c.get("box")
                       else 960.0)
            alvo_cy = ((c["box"][1] + c["box"][3]) / 2 if c.get("box")
                       else float(c.get("y", 700)))
            melhor, melhor_d = None, 1e9
            for b in r.boxes:
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                d = abs((x1 + x2) / 2 - alvo_cx) + abs((y1 + y2) / 2 - alvo_cy)
                if d < melhor_d:
                    melhor_d, melhor = d, (x1, y1, x2, y2)
            if melhor is None or melhor_d > 400:
                sem_caixa.append(c["id"])
                continue

            # demais objetos do frame (rotulados pelo yolov8x)
            linhas = []
            rx = x(fr, conf=0.40, imgsz=1280, classes=list(REMAP),
                   agnostic_nms=True, verbose=False)[0]
            for b in rx.boxes:
                cls = REMAP[int(b.cls[0])]
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                if cls == 1:
                    continue   # bicicletas do frame: usamos só a confirmada
                linhas.append(f"{cls} {(x1+x2)/2/w:.5f} {(y1+y2)/2/h:.5f} "
                              f"{(x2-x1)/w:.5f} {(y2-y1)/h:.5f}")
            bx1, by1, bx2, by2 = melhor
            linhas.append(f"1 {(bx1+bx2)/2/w:.5f} {(by1+by2)/2/h:.5f} "
                          f"{(bx2-bx1)/w:.5f} {(by2-by1)/h:.5f}")

            nome = f"cr_{c['id']}"
            cv2.imwrite(str(out_img / f"{nome}.jpg"), fr,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out_lbl / f"{nome}.txt").write_text("\n".join(linhas))
            n_ok += 1
        print(f"[{hora}] ok", flush=True)

    (RAIZ / "mineracao/sem_caixa.json").write_text(json.dumps(sem_caixa))
    print(f"{n_ok} exemplos adicionados ao dataset; "
          f"{len(sem_caixa)} sem caixa recuperável (mineracao/sem_caixa.json)")
    print("Agora rode: python avaliacao/treinar_ft.py")


if __name__ == "__main__":
    main()
