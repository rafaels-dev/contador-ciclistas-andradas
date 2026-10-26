"""
Leitura sequencial de vídeo via ffmpeg, com decodificação na GPU (NVDEC) e
redução para no máx. 1920 px de largura ainda na GPU.

Por quê: nos vídeos 4K/HEVC o gargalo do worker era decodificar na CPU
(OpenCV ~100 fps, com a GPU ociosa). Com NVDEC + scale_cuda saindo em
YUV420 (a conversão de cor para BGR no ffmpeg é cara; no OpenCV custa ~1 ms)
a leitura passa de ~450 fps quase sem CPU. Sem ffmpeg com CUDA, cai para
decodificação na CPU com o mesmo formato de saída.

`-fps_mode passthrough`: um quadro de saída por quadro decodificado, sem
duplicar/descartar para "acertar" a taxa — os índices de frame batem com a
leitura sequencial do OpenCV usada no resto do projeto. (Nada de seek: ver
o quirk de DVR no CLAUDE.md.)

Área de análise (`area`): o quadro é recortado ANTES da redução, na
resolução original — numa câmera 4K alta, o ciclista de ~60 px que virava
~17 px no 1080p reduzido continua com ~60 px. O `crop` comum funciona em
quadros CUDA antes do `scale_cuda` no FFmpeg recente; como uma versão antiga
poderia ignorá-lo em silêncio, o 1º quadro da GPU é conferido contra o da CPU.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

LARGURA_MAX = 1920


def _ffmpeg() -> str:
    for cand in (os.environ.get("CONTADOR_FFMPEG"),
                 str(Path.home() / ".local/opt/ffmpeg-btbn/bin/ffmpeg"),
                 shutil.which("ffmpeg")):
        if cand and Path(cand).exists():
            return cand
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def gravar_jpg(caminho: str | Path, img: np.ndarray, qualidade: int = 85) -> None:
    """cv2.imwrite falha em silêncio em caminhos com acento no Windows (a
    pasta de dados do app é "Contador de Tráfego"): codifica e grava os bytes."""
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
    if not ok:
        raise RuntimeError(f"não consegui codificar {caminho}")
    Path(caminho).write_bytes(buf.tobytes())


def info_video(caminho: str) -> dict:
    cap = cv2.VideoCapture(caminho)
    if not cap.isOpened():
        raise RuntimeError("não foi possível abrir o vídeo")
    d = {
        "fps": cap.get(cv2.CAP_PROP_FPS) or 15.0,
        "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
        "largura": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "altura": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    cap.release()
    return d


def area_em_px(area: tuple[float, float, float, float] | None, largura: int, altura: int):
    """Área (x, y, w, h em 0–1 do quadro) → px pares do vídeo original; None = quadro inteiro."""
    if not area:
        return None
    par = lambda v: int(v) // 2 * 2  # noqa: E731 — yuv420 exige dimensões pares
    x, y = par(max(0.0, area[0]) * largura), par(max(0.0, area[1]) * altura)
    w = par(min(largura - x, area[2] * largura))
    h = par(min(altura - y, area[3] * altura))
    if w < 64 or h < 64 or (w >= largura and h >= altura):
        return None
    return x, y, w, h


class LeitorVideo:
    """Itera quadros BGR (já reduzidos a `largura` × `altura`).

    Coordenadas de quadro → vídeo original: x_orig = ox + x * fator (idem y)."""

    def __init__(self, caminho: str, largura_max: int = LARGURA_MAX, gpu: bool | None = None,
                 area: tuple[int, int, int, int] | None = None):
        self.caminho = caminho
        self.info = info_video(caminho)
        self.area = area  # px do original (x, y, w, h) ou None
        self.ox, self.oy, w, h = area if area else (0, 0, self.info["largura"], self.info["altura"])
        if w > largura_max:
            self.largura = largura_max
            self.altura = int(round(h * largura_max / w / 2)) * 2
        else:
            self.largura, self.altura = w, h
        # fator para voltar às coordenadas do vídeo original
        self.fator = w / self.largura
        self._tam = self.largura * self.altura * 3 // 2
        self._proc: subprocess.Popen | None = None
        usar_gpu = gpu if gpu is not None else os.environ.get("CONTADOR_SEM_NVDEC") != "1"
        self.gpu = usar_gpu and self._abrir(gpu=True)
        if self.gpu and area and not self._gpu_recorta():
            self.gpu = False
        if not self.gpu:
            self._abrir(gpu=False)

    def _filtro(self, gpu: bool) -> str:
        recorte = f"crop={self.area[2]}:{self.area[3]}:{self.area[0]}:{self.area[1]}," if self.area else ""
        if gpu:
            return f"{recorte}scale_cuda={self.largura}:{self.altura}:format=yuv420p,hwdownload,format=yuv420p"
        return f"{recorte}scale={self.largura}:{self.altura}"

    def _comando(self, gpu: bool, quadros: int | None = None) -> list[str]:
        base = [_ffmpeg(), "-hide_banner", "-loglevel", "error", "-nostdin"]
        fim = ["-frames:v", str(quadros)] if quadros else []
        if gpu:
            return base + ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-i", self.caminho,
                           "-vf", self._filtro(True), *fim,
                           "-fps_mode", "passthrough", "-f", "rawvideo", "-"]
        return base + ["-i", self.caminho, "-vf", self._filtro(False), *fim,
                       "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-f", "rawvideo", "-"]

    def _gpu_recorta(self) -> bool:
        """O 1º quadro da GPU é o mesmo recorte que a CPU faz?"""
        cpu = subprocess.run(self._comando(False, quadros=1), capture_output=True).stdout
        if len(cpu) < self._tam or self._primeiro is None:
            return False
        a = np.frombuffer(self._primeiro, np.uint8)[: self.largura * self.altura].astype(np.int16)
        b = np.frombuffer(cpu, np.uint8)[: self.largura * self.altura].astype(np.int16)
        return float(np.abs(a - b).mean()) < 6

    def _abrir(self, gpu: bool) -> bool:
        self.fechar()
        self._proc = subprocess.Popen(self._comando(gpu), stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, bufsize=self._tam * 4)
        self._primeiro = self._ler_bruto()
        if self._primeiro is None:
            self.fechar()
            return False
        return True

    def _ler_bruto(self) -> bytes | None:
        assert self._proc and self._proc.stdout
        buf = self._proc.stdout.read(self._tam)
        return buf if buf and len(buf) == self._tam else None

    def ler(self) -> np.ndarray | None:
        if self._primeiro is not None:
            bruto, self._primeiro = self._primeiro, None
        else:
            bruto = self._ler_bruto() if self._proc else None
        if bruto is None:
            return None
        yuv = np.frombuffer(bruto, np.uint8).reshape(self.altura * 3 // 2, self.largura)
        return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)

    def pular(self) -> bool:
        """Avança um quadro sem converter (ainda precisa decodificar)."""
        if self._primeiro is not None:
            self._primeiro = None
            return True
        return self._ler_bruto() is not None if self._proc else False

    def fechar(self) -> None:
        if self._proc:
            self._proc.kill()
            self._proc.wait()
            self._proc = None

    def __iter__(self):
        while (f := self.ler()) is not None:
            yield f
        self.fechar()
