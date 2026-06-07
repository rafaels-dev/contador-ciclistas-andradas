#!/usr/bin/env python3
"""
Streaming em tempo real — 4 contadores: ciclistas, pedestres, automóveis, motos.

Suporta:
  - Stream RTSP  (rtsp://usuario:senha@192.168.1.10/stream)
  - Arquivo MP4  (Andradas.mp4)
  - Webcam       (índice inteiro: 0, 1, …)

Saída via stdout: JSON linha-a-linha (integrável com Kafka, MQTT, banco de dados).

Uso:
    python stream_tempo_real.py rtsp://192.168.1.100/cam4 --cam-id CAM4
    python stream_tempo_real.py Andradas.mp4
    python stream_tempo_real.py 0 --sem-janela
    python stream_tempo_real.py rtsp://... --pular 1   # processa 1 a cada 2 frames
"""

import argparse
import json
import os
import signal
import sys
import time

import cv2

import config
from contador import ContadorVeiculos, anotar_frame


def tem_display() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def publicar(evento: dict) -> None:
    print(json.dumps(evento, ensure_ascii=False), flush=True)


def processar_stream(
    fonte: str,
    cam_id: str = "CAM",
    mostrar_janela: bool = True,
    largura_janela: int = 1280,
    altura_janela: int = 720,
    pular_frames: int = 0,
    linha_x: int | None = None,
) -> None:
    try:
        fonte = int(fonte)
    except (ValueError, TypeError):
        pass

    cap = cv2.VideoCapture(fonte)
    if not cap.isOpened():
        sys.exit(f"Erro: não foi possível abrir '{fonte}'")

    if isinstance(fonte, str) and fonte.startswith("rtsp"):
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)

    fps_fonte = cap.get(cv2.CAP_PROP_FPS) or 15
    largura   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    altura    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    exibir = mostrar_janela and tem_display()
    if exibir:
        cv2.namedWindow("Contador Veículos", cv2.WINDOW_RESIZABLE)
        cv2.resizeWindow("Contador Veículos", largura_janela, altura_janela)

    contador = ContadorVeiculos(linha_x=linha_x)

    parar = False

    def _sair(sig, frame):
        nonlocal parar
        parar = True

    signal.signal(signal.SIGINT, _sair)
    signal.signal(signal.SIGTERM, _sair)

    publicar({
        "evento": "inicio",
        "cam_id": cam_id,
        "resolucao": f"{largura}x{altura}",
        "fps": fps_fonte,
        "timestamp": time.time(),
    })
    print(f"Stream: '{fonte}'  {largura}x{altura} @ {fps_fonte:.1f}fps", flush=True)

    frame_num = 0
    t_ultimo_hb = time.time()
    resultado = None

    _CATS = [
        ("ciclistas",    lambda r: (r.novos_ciclistas,    r.total_ciclistas,    r.cic_in,  r.cic_out)),
        ("pedestres",    lambda r: (r.novos_pedestres,    r.total_pedestres,    r.ped_in,  r.ped_out)),
        ("automoveis",   lambda r: (r.novos_automoveis,   r.total_automoveis,   r.aut_in,  r.aut_out)),
        ("motocicletas", lambda r: (r.novos_motocicletas, r.total_motocicletas, r.mot_in,  r.mot_out)),
    ]

    while not parar:
        ok, frame = cap.read()
        if not ok:
            if isinstance(fonte, str) and fonte.startswith("rtsp"):
                print("Stream perdido, reconectando em 3s...", flush=True)
                time.sleep(3)
                cap.open(fonte)
                continue
            break

        frame_num += 1

        if pular_frames > 0 and frame_num % (pular_frames + 1) != 0:
            if exibir:
                cv2.imshow("Contador Veículos", cv2.resize(frame, (largura_janela, altura_janela)))
                if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                    break
            continue

        resultado = contador.processar(frame)
        r = resultado

        for cat, fn in _CATS:
            novos, total, ent, sai = fn(r)
            if novos > 0:
                publicar({
                    "evento": "contagem",
                    "cam_id": cam_id,
                    "categoria": cat,
                    "frame": frame_num,
                    "total": total,
                    "in": ent,
                    "out": sai,
                    "timestamp": time.time(),
                })

        agora = time.time()
        if agora - t_ultimo_hb >= 30:
            publicar({
                "evento": "heartbeat",
                "cam_id": cam_id,
                "ciclistas":    r.total_ciclistas,
                "pedestres":    r.total_pedestres,
                "automoveis":   r.total_automoveis,
                "motocicletas": r.total_motocicletas,
                "timestamp": agora,
            })
            t_ultimo_hb = agora

        if exibir:
            lx = linha_x if linha_x is not None else largura // 2
            anotado = anotar_frame(frame, resultado, lx)
            cv2.imshow("Contador Veículos",
                       cv2.resize(anotado, (largura_janela, altura_janela)))
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break

    cap.release()
    if exibir:
        cv2.destroyAllWindows()

    r = resultado
    publicar({
        "evento": "encerramento",
        "cam_id": cam_id,
        "ciclistas":    r.total_ciclistas    if r else 0,
        "pedestres":    r.total_pedestres    if r else 0,
        "automoveis":   r.total_automoveis   if r else 0,
        "motocicletas": r.total_motocicletas if r else 0,
        "frames_processados": frame_num,
        "timestamp": time.time(),
    })


def main():
    p = argparse.ArgumentParser(
        description="Contador em tempo real: ciclistas, pedestres, automóveis e motos"
    )
    p.add_argument("fonte",      nargs="?", default="Andradas.mp4",
                   help="RTSP URL, arquivo de vídeo ou índice de webcam")
    p.add_argument("--cam-id",   default="CAM")
    p.add_argument("--sem-janela", action="store_true")
    p.add_argument("--pular",    type=int, default=0, metavar="N",
                   help="Processa 1 a cada N+1 frames (reduz carga de CPU)")
    p.add_argument("--linha-x",  type=int, default=None)
    args = p.parse_args()

    processar_stream(
        fonte=args.fonte,
        cam_id=args.cam_id,
        mostrar_janela=not args.sem_janela,
        pular_frames=args.pular,
        linha_x=args.linha_x,
    )


if __name__ == "__main__":
    main()
