#!/usr/bin/env python3
"""
Video metadata + first frame (for the user to draw the lines on).

Usage: python worker/info.py VIDEO OUTPUT_DIR
Writes OUTPUT_DIR/frame0.jpg and prints one JSON line:
  {"type": "info", "fps": ..., "frames": ..., "width": ..., "height": ..., "duration_s": ...}
Errors: {"type": "error", "code": ..., "message": ...} — the app translates `code`.
"""
import json
import sys

# JSON events carry "→" and "…": on Windows stdout starts as cp1252
if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reader import write_jpg  # noqa: E402


def fail(code: str, message: str) -> None:
    print(json.dumps({"type": "error", "code": code, "message": message}), flush=True)
    sys.exit(1)


def main() -> None:
    video, output = sys.argv[1], Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        fail("video_unreadable", "could not open the video")

    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    # the first few DVR frames come out black/corrupted — take the 10th
    frame = None
    for _ in range(10):
        ok, f = cap.read()
        if not ok:
            break
        frame = f
    cap.release()
    if frame is None:
        fail("video_no_frames", "video has no readable frames")

    write_jpg(output / "frame0.jpg", frame, 90)
    height, width = frame.shape[:2]
    print(json.dumps({
        "type": "info",
        "fps": fps,
        "frames": frames,
        "width": width,
        "height": height,
        "duration_s": frames / fps if fps else 0,
    }), flush=True)


if __name__ == "__main__":
    main()
