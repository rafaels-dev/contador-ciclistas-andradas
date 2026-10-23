#!/usr/bin/env python3
"""
Metadados do vídeo + 1º frame (para o usuário desenhar as linhas).

Uso: python worker/info.py VIDEO DIR_SAIDA
Escreve DIR_SAIDA/frame0.jpg e imprime uma linha JSON:
  {"tipo": "info", "fps": ..., "frames": ..., "largura": ..., "altura": ..., "duracao_s": ...}
"""
import json
import sys

# os eventos JSON levam "→" e "…": no Windows o stdout nasce em cp1252
if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from leitor import gravar_jpg  # noqa: E402


def main() -> None:
    video, saida = sys.argv[1], Path(sys.argv[2])
    saida.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print(json.dumps({"tipo": "erro", "mensagem": "não foi possível abrir o vídeo"}), flush=True)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    # alguns frames iniciais de DVR vêm pretos/corrompidos — pega o 10º
    frame = None
    for _ in range(10):
        ok, f = cap.read()
        if not ok:
            break
        frame = f
    cap.release()
    if frame is None:
        print(json.dumps({"tipo": "erro", "mensagem": "vídeo sem frames legíveis"}), flush=True)
        sys.exit(1)

    gravar_jpg(saida / "frame0.jpg", frame, 90)
    altura, largura = frame.shape[:2]
    print(json.dumps({
        "tipo": "info",
        "fps": fps,
        "frames": frames,
        "largura": largura,
        "altura": altura,
        "duracao_s": frames / fps if fps else 0,
    }), flush=True)


if __name__ == "__main__":
    main()
