#!/usr/bin/env python3
"""
Processa um arquivo de vídeo e conta 4 categorias independentes:
  - Ciclistas    (pessoa com bicicleta)
  - Pedestres    (pessoa sem bicicleta)
  - Automóveis   (carro, ônibus, caminhão)
  - Motocicletas

Gera vídeo anotado em H.264 (tamanho similar ao original) e JSON com eventos.

Uso:
    python processar_video.py                        # processa Andradas.mp4
    python processar_video.py --video outro.mp4
    python processar_video.py --sem-video            # só estatísticas, sem vídeo
    python processar_video.py --inicio 120 --fim 180 # trecho 2:00–3:00
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2

import config
from contador import ContadorVeiculos, anotar_frame

_ICONES = {
    "ciclistas":    "🚲",
    "pedestres":    "🚶",
    "automoveis":   "🚗",
    "motocicletas": "🏍️",
}

_CATEGORIAS = [
    ("ciclistas",    lambda r: (r.novos_ciclistas,    r.total_ciclistas)),
    ("pedestres",    lambda r: (r.novos_pedestres,    r.total_pedestres)),
    ("automoveis",   lambda r: (r.novos_automoveis,   r.total_automoveis)),
    ("motocicletas", lambda r: (r.novos_motocicletas, r.total_motocicletas)),
]


# ---------------------------------------------------------------------------
# Video writer abstraction: H.264 via ffmpeg quando disponível, mp4v fallback
# ---------------------------------------------------------------------------

def _encontrar_ffmpeg() -> str | None:
    """Retorna o caminho do ffmpeg (sistema ou embutido no imageio-ffmpeg)."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


class _Writer:
    """
    Gravador de vídeo com H.264 via ffmpeg (pipe) ou mp4v como fallback.

    Uso:
        with _Writer(saida, fps, largura, altura) as w:
            w.write(frame)
    """

    def __init__(self, saida: str, fps: float, largura: int, altura: int):
        self._proc   = None
        self._writer = None
        self._codec  = "desconhecido"

        ffmpeg = _encontrar_ffmpeg()
        if ffmpeg:
            cmd = [
                ffmpeg, "-y",
                "-f", "rawvideo", "-vcodec", "rawvideo",
                "-s", f"{largura}x{altura}",
                "-pix_fmt", "bgr24",
                "-r", str(fps),
                "-i", "pipe:",
                "-vcodec", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                saida,
            ]
            self._proc  = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                           stderr=subprocess.DEVNULL)
            self._codec = "H.264 (libx264)"
        else:
            fourcc       = cv2.VideoWriter_fourcc(*"mp4v")
            self._writer = cv2.VideoWriter(saida, fourcc, fps, (largura, altura))
            self._codec  = "mp4v (fallback — instale ffmpeg para H.264)"

    def write(self, frame) -> None:
        if self._proc:
            self._proc.stdin.write(frame.tobytes())
        else:
            self._writer.write(frame)

    def release(self) -> None:
        if self._proc:
            self._proc.stdin.close()
            self._proc.wait()
        else:
            self._writer.release()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.release()

    @property
    def codec(self) -> str:
        return self._codec


# ---------------------------------------------------------------------------
# Processamento principal
# ---------------------------------------------------------------------------

def processar(
    caminho_video: str,
    saida_video: str | None,
    saida_json: str,
    inicio_s: float = 0,
    fim_s: float | None = None,
) -> dict:
    cap = cv2.VideoCapture(caminho_video)
    if not cap.isOpened():
        sys.exit(f"Erro: não foi possível abrir '{caminho_video}'")

    fps      = cap.get(cv2.CAP_PROP_FPS)
    largura  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    altura   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    f_inicio = int(inicio_s * fps)
    f_fim    = int(fim_s * fps) if fim_s else n_frames

    print(f"Vídeo     : {caminho_video}")
    print(f"Resolução : {largura}x{altura} @ {fps:.1f}fps  |  "
          f"Duração: {n_frames/fps:.1f}s")
    print(f"Intervalo : frames {f_inicio}–{f_fim} "
          f"({(f_fim - f_inicio)/fps:.1f}s)\n")

    writer: _Writer | None = None
    if saida_video:
        writer = _Writer(saida_video, fps, largura, altura)
        print(f"Codec de saída: {writer.codec}\n")

    contador = ContadorVeiculos()

    if f_inicio > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_inicio)

    eventos: list[dict] = []
    frame_atual = f_inicio
    resultado = None
    t0 = time.time()

    try:
        while frame_atual < f_fim:
            ok, frame = cap.read()
            if not ok:
                break

            resultado = contador.processar(frame)

            ts = frame_atual / fps
            mm, ss = divmod(ts, 60)
            for cat, fn in _CATEGORIAS:
                novos, total = fn(resultado)
                if novos > 0:
                    ev = {
                        "categoria": cat,
                        "frame": frame_atual,
                        "tempo": f"{int(mm):02d}:{ss:05.2f}",
                        "total_categoria": total,
                    }
                    eventos.append(ev)
                    print(f"  {_ICONES[cat]} {cat:13s}  frame {frame_atual} "
                          f"({ev['tempo']}) | total: {total}")

            if writer:
                anotado = anotar_frame(frame, resultado, config.LINHA_X)
                writer.write(anotado)

            frame_atual += 1

            if frame_atual % 150 == 0:
                pct     = (frame_atual - f_inicio) / (f_fim - f_inicio) * 100
                elapsed = time.time() - t0
                eta     = elapsed / max(pct, 0.1) * (100 - pct)
                r = resultado
                print(
                    f"  [{pct:5.1f}%] frame {frame_atual}/{f_fim}  ETA:{eta:.0f}s  "
                    f"cic={r.total_ciclistas} ped={r.total_pedestres} "
                    f"aut={r.total_automoveis} mot={r.total_motocicletas}",
                    end="\r",
                )
    finally:
        cap.release()
        if writer:
            writer.release()

    elapsed = time.time() - t0
    r = resultado

    stats = {
        "video": caminho_video,
        "resolucao": f"{largura}x{altura}",
        "fps": fps,
        "frames_processados": frame_atual - f_inicio,
        "duracao_processada_s": round((frame_atual - f_inicio) / fps, 2),
        "tempo_processamento_s": round(elapsed, 2),
        "velocidade_x_realtime": round((frame_atual - f_inicio) / fps / elapsed, 2),
        "totais": {
            "ciclistas":    r.total_ciclistas    if r else 0,
            "pedestres":    r.total_pedestres    if r else 0,
            "automoveis":   r.total_automoveis   if r else 0,
            "motocicletas": r.total_motocicletas if r else 0,
        },
        "direcoes": {
            "ciclistas":    {"in": r.cic_in, "out": r.cic_out} if r else {},
            "pedestres":    {"in": r.ped_in, "out": r.ped_out} if r else {},
            "automoveis":   {"in": r.aut_in, "out": r.aut_out} if r else {},
            "motocicletas": {"in": r.mot_in, "out": r.mot_out} if r else {},
        },
        "eventos": eventos,
    }

    Path(saida_json).write_text(json.dumps(stats, indent=2, ensure_ascii=False))

    print(f"\n\n{'─'*52}")
    print(f"  Ciclistas    : {stats['totais']['ciclistas']}")
    print(f"  Pedestres    : {stats['totais']['pedestres']}")
    print(f"  Automóveis   : {stats['totais']['automoveis']}")
    print(f"  Motocicletas : {stats['totais']['motocicletas']}")
    print(f"{'─'*52}")
    print(f"  Processamento: {elapsed:.1f}s "
          f"({stats['velocidade_x_realtime']}× tempo real)")
    if saida_video:
        print(f"  Vídeo anotado: {saida_video}")
        tam = Path(saida_video).stat().st_size / 1_048_576
        print(f"  Tamanho      : {tam:.1f} MB")
    print(f"  JSON         : {saida_json}")

    return stats


def main():
    p = argparse.ArgumentParser(
        description="Conta ciclistas, pedestres, automóveis e motos em vídeo"
    )
    p.add_argument("--video",     default="Andradas.mp4")
    p.add_argument("--saida",     default=None,           help="Vídeo de saída anotado")
    p.add_argument("--json",      default="resultado.json")
    p.add_argument("--sem-video", action="store_true",    help="Não salva vídeo anotado")
    p.add_argument("--inicio",    type=float, default=0,  metavar="SEGUNDOS")
    p.add_argument("--fim",       type=float, default=None, metavar="SEGUNDOS")
    args = p.parse_args()

    saida_video = None
    if not args.sem_video:
        saida_video = args.saida or Path(args.video).stem + "_anotado.mp4"

    processar(
        caminho_video=args.video,
        saida_video=saida_video,
        saida_json=args.json,
        inicio_s=args.inicio,
        fim_s=args.fim,
    )


if __name__ == "__main__":
    main()
