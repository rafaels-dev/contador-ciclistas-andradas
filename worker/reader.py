"""
Sequential video reading through ffmpeg, decoding on the GPU (NVDEC) and
downscaling to at most 1920 px wide while still on the GPU.

Why: on 4K/HEVC videos the worker's bottleneck was CPU decoding (OpenCV
~100 fps with the GPU idle). With NVDEC + scale_cuda emitting YUV420 (color
conversion to BGR in ffmpeg is expensive; in OpenCV it costs ~1 ms) reading
goes beyond ~450 fps with almost no CPU. Without a CUDA-enabled ffmpeg it
falls back to CPU decoding with the same output format.

`-fps_mode passthrough`: one output frame per decoded frame, without
duplicating/dropping to "fix" the rate — frame indices match the OpenCV
sequential read used throughout the project. (No seeking: see the DVR quirk
in CLAUDE.md.)

Analysis area (`area`): the frame is cropped BEFORE downscaling, at the
original resolution — on a high 4K camera, the ~60 px cyclist who became
~17 px in the downscaled 1080p keeps ~60 px. Plain `crop` works on CUDA
frames before `scale_cuda` in recent FFmpeg; since an old version could
silently ignore it, the first GPU frame is checked against the CPU one.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import threading
from collections import deque
from pathlib import Path

import cv2
import numpy as np

MAX_WIDTH = 1920

# variables renamed in 0.0.8 (CONTADOR_*): the old names keep working
LEGACY_ENV = {"TRAFFIC_COUNTER_FFMPEG": "CONTADOR_FFMPEG",
              "TRAFFIC_COUNTER_NO_NVDEC": "CONTADOR_SEM_NVDEC"}


def env(name: str) -> str | None:
    """Environment variable `name`, or its name before 0.0.8."""
    value = os.environ.get(name)
    if value is None and name in LEGACY_ENV:
        value = os.environ.get(LEGACY_ENV[name])
    return value


def _ffmpeg() -> str:
    for cand in (env("TRAFFIC_COUNTER_FFMPEG"),
                 str(Path.home() / ".local/opt/ffmpeg-btbn/bin/ffmpeg"),
                 shutil.which("ffmpeg")):
        if cand and Path(cand).exists():
            return cand
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


class StderrTail:
    """Reads a process's stderr until it closes, keeping only the last lines
    (for error messages) — without it the pipe fills and the process hangs."""

    def __init__(self, stream, lines: int = 20):
        self._lines: deque[bytes] = deque(maxlen=lines)
        self._thread = threading.Thread(target=self._loop, args=(stream,), daemon=True)
        self._thread.start()

    def _loop(self, stream) -> None:
        for line in iter(stream.readline, b""):
            self._lines.append(line)
        stream.close()

    def text(self) -> str:
        """The last lines; waits for the stream to close (call after the process ends)."""
        self._thread.join(timeout=5)
        return b"".join(self._lines).decode(errors="replace").strip()


def write_jpg(path: str | Path, img: np.ndarray, quality: int = 85) -> None:
    """cv2.imwrite fails silently on paths with accents on Windows (user
    folders often have them): encode and write the bytes instead."""
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError(f"could not encode {path}")
    Path(path).write_bytes(buf.tobytes())


def video_info(path: str) -> dict:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError("could not open the video")
    d = {
        "fps": cap.get(cv2.CAP_PROP_FPS) or 15.0,
        "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    cap.release()
    return d


def area_to_px(area: tuple[float, float, float, float] | None, width: int, height: int):
    """Area (x, y, w, h in 0–1 of the frame) → even px of the original video; None = whole frame."""
    if not area:
        return None
    even = lambda v: int(v) // 2 * 2  # noqa: E731 — yuv420 needs even dimensions
    x, y = even(max(0.0, area[0]) * width), even(max(0.0, area[1]) * height)
    w = even(min(width - x, area[2] * width))
    h = even(min(height - y, area[3] * height))
    if w < 64 or h < 64 or (w >= width and h >= height):
        return None
    return x, y, w, h


class VideoReader:
    """Iterates BGR frames (already downscaled to `width` × `height`).

    Frame → original video coordinates: x_orig = ox + x * factor (same for y)."""

    def __init__(self, path: str, max_width: int = MAX_WIDTH, gpu: bool | None = None,
                 area: tuple[int, int, int, int] | None = None):
        self.path = path
        self.info = video_info(path)
        self.area = area  # px of the original (x, y, w, h) or None
        self.ox, self.oy, w, h = area if area else (0, 0, self.info["width"], self.info["height"])
        if w > max_width:
            self.width = max_width
            self.height = int(round(h * max_width / w / 2)) * 2
        else:
            self.width, self.height = w, h
        # factor back to the original video coordinates
        self.factor = w / self.width
        self._size = self.width * self.height * 3 // 2
        self._proc: subprocess.Popen | None = None
        use_gpu = gpu if gpu is not None else env("TRAFFIC_COUNTER_NO_NVDEC") != "1"
        self.gpu = use_gpu and self._open(gpu=True)
        if self.gpu and area and not self._gpu_crops():
            self.gpu = False
        if not self.gpu:
            self._open(gpu=False)

    def _filter(self, gpu: bool) -> str:
        crop = f"crop={self.area[2]}:{self.area[3]}:{self.area[0]}:{self.area[1]}," if self.area else ""
        if gpu:
            return f"{crop}scale_cuda={self.width}:{self.height}:format=yuv420p,hwdownload,format=yuv420p"
        return f"{crop}scale={self.width}:{self.height}"

    def _command(self, gpu: bool, frames: int | None = None) -> list[str]:
        base = [_ffmpeg(), "-hide_banner", "-loglevel", "error", "-nostdin"]
        limit = ["-frames:v", str(frames)] if frames else []
        if gpu:
            return base + ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-i", self.path,
                           "-vf", self._filter(True), *limit,
                           "-fps_mode", "passthrough", "-f", "rawvideo", "-"]
        return base + ["-i", self.path, "-vf", self._filter(False), *limit,
                       "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-f", "rawvideo", "-"]

    def _gpu_crops(self) -> bool:
        """Is the first GPU frame the same crop the CPU produces?"""
        cpu = subprocess.run(self._command(False, frames=1), capture_output=True).stdout
        if len(cpu) < self._size or self._first is None:
            return False
        a = np.frombuffer(self._first, np.uint8)[: self.width * self.height].astype(np.int16)
        b = np.frombuffer(cpu, np.uint8)[: self.width * self.height].astype(np.int16)
        return float(np.abs(a - b).mean()) < 6

    def _open(self, gpu: bool) -> bool:
        self.close()
        self._proc = subprocess.Popen(self._command(gpu), stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, bufsize=self._size * 4)
        StderrTail(self._proc.stderr)
        self._first = self._read_raw()
        if self._first is None:
            self.close()
            return False
        return True

    def _read_raw(self) -> bytes | None:
        assert self._proc and self._proc.stdout
        buf = self._proc.stdout.read(self._size)
        return buf if buf and len(buf) == self._size else None

    def read(self) -> np.ndarray | None:
        if self._first is not None:
            raw, self._first = self._first, None
        else:
            raw = self._read_raw() if self._proc else None
        if raw is None:
            return None
        yuv = np.frombuffer(raw, np.uint8).reshape(self.height * 3 // 2, self.width)
        return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)

    def skip(self) -> bool:
        """Advances one frame without converting it (still has to decode)."""
        if self._first is not None:
            self._first = None
            return True
        return self._read_raw() is not None if self._proc else False

    def close(self) -> None:
        if self._proc:
            self._proc.kill()
            self._proc.wait()
            self._proc = None

    def __iter__(self):
        while (f := self.read()) is not None:
            yield f
        self.close()
