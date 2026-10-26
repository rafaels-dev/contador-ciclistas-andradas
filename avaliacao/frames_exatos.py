"""
Extração de frames EXATOS por índice, com decodificação sequencial.

cap.set(CAP_PROP_POS_FRAMES) erra ~30 s (~450 frames) nos arquivos deste
DVR: o seek é feito por tempo com fps médio, mas o índice do container é
inconsistente, e o erro é silencioso (get() reporta a posição pedida).

A única forma confiável de casar com a numeração dos runners (que leem
sequencialmente) é decodificar sequencialmente do frame 0. cv2.grab()
pula frames sem converter — ~1 min por hora de vídeo.

Uso:
    from frames_exatos import frames_exatos
    for idx, frame in frames_exatos("video.mp4", [100, 250, 900]):
        ...
"""
from __future__ import annotations

import cv2


def frames_exatos(video: str, indices: list[int]):
    """Gera (indice, frame) na ordem crescente dos índices pedidos.
    Decodificação 100% sequencial a partir do frame 0."""
    alvos = sorted(set(int(i) for i in indices))
    if not alvos:
        return
    cap = cv2.VideoCapture(video)
    try:
        atual = 0
        for alvo in alvos:
            while atual < alvo:
                if not cap.grab():
                    return
                atual += 1
            ok, frame = cap.read()
            if not ok:
                return
            atual += 1
            yield alvo, frame
    finally:
        cap.release()
