#!/usr/bin/env python3
"""
Gera, para cada candidato minerado, um clipe MP4 de 3 s (480x270, loop no
app) e um keyframe JPG (960px, com a caixa candidata desenhada quando
existir). Decodificação 100% sequencial por vídeo (imune ao bug de seek).

Saída: avaliacao/mineracao/webapp/clipes/<id>.mp4 e <id>.jpg
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2

RAIZ = Path(__file__).resolve().parent
FPS = 14.874455802535433
MEIA_JANELA = 22   # ~1,5 s para cada lado


def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    cands = json.loads((RAIZ / "mineracao/candidatos.json").read_text())
    out = RAIZ / "mineracao/webapp/clipes"
    out.mkdir(parents=True, exist_ok=True)
    ff = ffmpeg_exe()

    por_hora = {}
    for c in cands:
        por_hora.setdefault(c["hora"], []).append(c)

    for hora, lista in sorted(por_hora.items()):
        video = RAIZ / f"videos/Andradas_{hora}.mp4"
        lista.sort(key=lambda c: c["frame"])
        janelas = [(max(0, c["frame"] - MEIA_JANELA),
                    c["frame"] + MEIA_JANELA, c) for c in lista]
        cap = cv2.VideoCapture(str(video))
        abertos = []   # (fim, proc, cand)
        idx_prox = 0
        i = 0
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            while idx_prox < len(janelas) and janelas[idx_prox][0] == i:
                ini, fim, c = janelas[idx_prox]
                idx_prox += 1
                proc = subprocess.Popen(
                    [ff, "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
                     "-s", "480x270", "-pix_fmt", "bgr24", "-r", "15",
                     "-i", "pipe:", "-vcodec", "libx264", "-preset", "fast",
                     "-crf", "27", "-pix_fmt", "yuv420p",
                     str(out / f"{c['id']}.mp4")],
                    stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
                abertos.append([fim, proc, c])
            # despacha frame para clipes abertos
            if abertos:
                peq = cv2.resize(fr, (480, 270))
                cv2.line(peq, (240, 0), (240, 270), (0, 0, 255), 1)
            for slot in abertos:
                slot[1].stdin.write(peq.tobytes())
            # keyframe no frame central
            for _, _, c in abertos:
                if c["frame"] == i:
                    kf = fr.copy()
                    cv2.line(kf, (960, 0), (960, 1080), (0, 0, 255), 2)
                    if c.get("box"):
                        x1, y1, x2, y2 = [int(v) for v in c["box"]]
                        cv2.rectangle(kf, (x1, y1), (x2, y2), (0, 255, 0), 3)
                    elif c.get("y"):
                        cv2.circle(kf, (960, int(c["y"])), 70, (0, 255, 0), 3)
                    kf = cv2.resize(kf, (960, 540))
                    cv2.imwrite(str(out / f"{c['id']}.jpg"), kf,
                                [cv2.IMWRITE_JPEG_QUALITY, 82])
            # fecha clipes vencidos
            restam = []
            for slot in abertos:
                if i >= slot[0]:
                    slot[1].stdin.close()
                    slot[1].wait()
                else:
                    restam.append(slot)
            abertos = restam
            if idx_prox >= len(janelas) and not abertos:
                break
            i += 1
        for slot in abertos:
            slot[1].stdin.close()
            slot[1].wait()
        cap.release()
        print(f"[{hora}] {len(lista)} clipes", flush=True)
    print("clipes prontos", flush=True)


if __name__ == "__main__":
    main()
