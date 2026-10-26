"""
Conjunto de calibração para o modelo de visão: casos rotulados pelo
Cristiano (rotulos_andradas.json) → candidatos gerados pelo MESMO detector
do app (worker/detectar.py) em janelas de ±5 s → filmstrip + contexto.

Uso: python avaliacao/montar_calibracao_llm.py ROTULOS.json CANDIDATOS_MINERADOS.json DIR_VIDEOS SAIDA
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "worker"))
sys.path.insert(0, str(RAIZ))
import supervision as sv  # noqa: E402
from ultralytics import YOLO  # noqa: E402

import config  # noqa: E402
import detectar as D  # noqa: E402
from leitor import LeitorVideo  # noqa: E402

MAPA = {"bicicleta": "ciclistas", "pedestre": "pedestres", "carro": "automoveis",
        "moto": "motocicletas", "nada": "descartado"}
MEIA = 75  # ±5 s a 15 fps
LINHA_X = 960


def main():
    rot = json.loads(Path(sys.argv[1]).read_text())["rotulos"]
    minerados = {c["id"]: c for c in json.loads(Path(sys.argv[2]).read_text())}
    dir_videos, saida = Path(sys.argv[3]), Path(sys.argv[4])
    (saida / "filmstrips").mkdir(parents=True, exist_ok=True)
    (saida / "contextos").mkdir(parents=True, exist_ok=True)

    por_hora = defaultdict(list)
    for cid, l in rot.items():
        if l in MAPA:
            por_hora[minerados[cid]["hora"]].append({**minerados[cid], "rotulo": MAPA[l]})

    modelo = YOLO(str(RAIZ / config.MODELO))
    modelo_bic = YOLO(str(RAIZ / config.MODELO_BICICLETAS))
    classes = sorted({0, 1, 3, *config.CLASSES_AUTOMOVEIS})
    resultado = []

    for hora in sorted(por_hora):
        casos = sorted(por_hora[hora], key=lambda c: c["frame"])
        # janelas mescladas
        janelas = []
        for c in casos:
            a, b = c["frame"] - MEIA, c["frame"] + MEIA
            if janelas and a <= janelas[-1][1]:
                janelas[-1][1] = max(janelas[-1][1], b)
            else:
                janelas.append([a, b])
        leitor = LeitorVideo(str(dir_videos / f"Andradas_{hora}.mp4"))
        idx = -1
        alvos_frames = {c["frame"] for c in casos}
        for a, b in janelas:
            while idx + 1 < a and leitor.pular():
                idx += 1
            trackers = {g: sv.ByteTrack() for g in D.GRUPOS}
            tracks, quadros_alvo = {}, {}
            while idx + 1 <= b:
                f = leitor.ler()
                if f is None:
                    break
                idx += 1
                if idx in alvos_frames:
                    quadros_alvo[idx] = f
                r = modelo(f, conf=config.CONFIANCA, iou=config.IOU, imgsz=640, classes=classes,
                           agnostic_nms=True, verbose=False)[0]
                tudo = sv.Detections.from_ultralytics(r)
                rb = modelo_bic(f, conf=config.CONFIANCA, iou=config.IOU, imgsz=640, classes=[1], verbose=False)[0]
                pc = lambda d, ids: d[np.isin(d.class_id, ids)] if len(d) else d  # noqa: E731
                rast = {
                    "pes": trackers["pes"].update_with_detections(pc(tudo, [0])),
                    "bic": trackers["bic"].update_with_detections(sv.Detections.from_ultralytics(rb)),
                    "aut": trackers["aut"].update_with_detections(pc(tudo, config.CLASSES_AUTOMOVEIS)),
                    "mot": trackers["mot"].update_with_detections(pc(tudo, config.CLASSES_MOTOCICLETAS)),
                }
                for g, d in rast.items():
                    D._registrar(tracks, g, d, f, idx)
                D._associar(tracks, rast["pes"], rast["bic"], rast["mot"], 1.0)
            tracks = D.emendar_tracks(tracks, 15.0, 1.0)

            for c in casos:
                if not (a <= c["frame"] <= b):
                    continue
                alvo = np.array([LINHA_X, c["y"]]) if c.get("y") is not None else None
                if c.get("box"):
                    x1, y1, x2, y2 = c["box"]
                    alvo = np.array([(x1 + x2) / 2, (y1 + y2) / 2])
                melhor, melhor_d = None, 1e9
                for tr in tracks.values():
                    if tr.n < D.MIN_OBS:
                        continue
                    fr = np.array(tr.frames)
                    k = int(np.argmin(np.abs(fr - c["frame"])))
                    if abs(fr[k] - c["frame"]) > 10:
                        continue
                    bx = tr.caixas[k]
                    centro = np.array([(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2])
                    d = np.linalg.norm(centro - alvo)
                    # o condutor de bike/moto: pessoa associada perde para o veículo
                    if tr.grupo == "pes" and tr.associado():
                        d += 40
                    if d < melhor_d:
                        melhor, melhor_d = tr, d
                if melhor is None or melhor_d > 200:
                    continue
                D.salvar_filmstrip(melhor, saida / "filmstrips" / f"{c['id']}.jpg")
                quadro = quadros_alvo.get(c["frame"])
                if quadro is not None:
                    fr = np.array(melhor.frames)
                    bx = melhor.caixas[int(np.argmin(np.abs(fr - c["frame"])))]
                    x1, y1, x2, y2, ow, oh = D._regiao_clipe(melhor, c["frame"] - 22, c["frame"] + 22, 1920, 1080, 1.0)
                    img = cv2.resize(quadro[y1:y2, x1:x2].copy(), (ow, oh), interpolation=cv2.INTER_AREA)
                    sx, sy = ow / (x2 - x1), oh / (y2 - y1)
                    cv2.line(img, (int((LINHA_X - x1) * sx), 0), (int((LINHA_X - x1) * sx), oh), (0, 220, 255), 2)
                    cv2.rectangle(img, (int((bx[0] - x1) * sx), int((bx[1] - y1) * sy)),
                                  (int((bx[2] - x1) * sx), int((bx[3] - y1) * sy)), (0, 0, 255), 2)
                    cv2.imwrite(str(saida / "contextos" / f"{c['id']}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                grupo = melhor.associado() or melhor.grupo
                resultado.append({"id": c["id"], "hora": hora, "rotulo": c["rotulo"], "fonte": c["fonte"],
                                  "yolo": D.CATEGORIA_GRUPO[grupo], "dist": round(float(melhor_d), 1),
                                  "filmstrip": f"filmstrips/{c['id']}.jpg", "contexto": f"contextos/{c['id']}.jpg"})
        leitor.fechar()
        print(hora, "casos", len(casos), "casados até agora", len(resultado), flush=True)

    (saida / "calibracao.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=1))
    print("total casado:", len(resultado))


if __name__ == "__main__":
    main()
