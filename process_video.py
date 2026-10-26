#!/usr/bin/env python3
"""
Processes a video file and counts 4 independent categories:
  - Cyclists    (person on a bicycle)
  - Pedestrians (person without a bicycle)
  - Cars        (car, bus, truck)
  - Motorcycles

Writes an annotated H.264 video (size close to the original) and a JSON report.

Usage:
    python process_video.py                          # processes Andradas.mp4
    python process_video.py --video other.mp4
    python process_video.py --no-video               # stats only, no video
    python process_video.py --start 120 --end 180    # clip 2:00–3:00
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
from counter import TrafficCounter, annotate_frame

_ICONS = {
    "cyclists":    "🚲",
    "pedestrians": "🚶",
    "cars":        "🚗",
    "motorcycles": "🏍️",
}

_CATEGORIES = [
    ("cyclists",    lambda r: (r.new_cyclists,    r.total_cyclists)),
    ("pedestrians", lambda r: (r.new_pedestrians, r.total_pedestrians)),
    ("cars",        lambda r: (r.new_cars,        r.total_cars)),
    ("motorcycles", lambda r: (r.new_motorcycles, r.total_motorcycles)),
]


# ---------------------------------------------------------------------------
# Video writer abstraction: H.264 through ffmpeg when available, mp4v fallback
# ---------------------------------------------------------------------------

def _find_ffmpeg() -> str | None:
    """Returns the ffmpeg path (system install or the one bundled in imageio-ffmpeg)."""
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
    Video writer: H.264 through ffmpeg (pipe), or mp4v as a fallback.

    Usage:
        with _Writer(output, fps, width, height) as w:
            w.write(frame)
    """

    def __init__(self, output: str, fps: float, width: int, height: int):
        self._proc   = None
        self._writer = None
        self._codec  = "unknown"

        ffmpeg = _find_ffmpeg()
        if ffmpeg:
            cmd = [
                ffmpeg, "-y",
                "-f", "rawvideo", "-vcodec", "rawvideo",
                "-s", f"{width}x{height}",
                "-pix_fmt", "bgr24",
                "-r", str(fps),
                "-i", "pipe:",
                "-vcodec", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                output,
            ]
            self._proc  = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                           stderr=subprocess.DEVNULL)
            self._codec = "H.264 (libx264)"
        else:
            fourcc       = cv2.VideoWriter_fourcc(*"mp4v")
            self._writer = cv2.VideoWriter(output, fourcc, fps, (width, height))
            self._codec  = "mp4v (fallback — install ffmpeg for H.264)"

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
# Main processing
# ---------------------------------------------------------------------------

def process(
    video_path: str,
    output_video: str | None,
    output_json: str,
    start_s: float = 0,
    end_s: float | None = None,
) -> dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        sys.exit(f"Error: could not open '{video_path}'")

    fps      = cap.get(cv2.CAP_PROP_FPS)
    width    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    f_start = int(start_s * fps)
    f_end   = int(end_s * fps) if end_s else n_frames

    print(f"Video      : {video_path}")
    print(f"Resolution : {width}x{height} @ {fps:.1f}fps  |  "
          f"Duration: {n_frames/fps:.1f}s")
    print(f"Range      : frames {f_start}–{f_end} "
          f"({(f_end - f_start)/fps:.1f}s)\n")

    writer: _Writer | None = None
    if output_video:
        writer = _Writer(output_video, fps, width, height)
        print(f"Output codec: {writer.codec}\n")

    counter = TrafficCounter()

    if f_start > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_start)

    events: list[dict] = []
    frame_idx = f_start
    result = None
    t0 = time.time()

    try:
        while frame_idx < f_end:
            ok, frame = cap.read()
            if not ok:
                break

            result = counter.process(frame)

            ts = frame_idx / fps
            mm, ss = divmod(ts, 60)
            for cat, fn in _CATEGORIES:
                new, total = fn(result)
                if new > 0:
                    ev = {
                        "category": cat,
                        "frame": frame_idx,
                        "time": f"{int(mm):02d}:{ss:05.2f}",
                        "category_total": total,
                    }
                    events.append(ev)
                    print(f"  {_ICONS[cat]} {cat:13s}  frame {frame_idx} "
                          f"({ev['time']}) | total: {total}")

            if writer:
                writer.write(annotate_frame(frame, result, config.LINE_X))

            frame_idx += 1

            if frame_idx % 150 == 0:
                pct     = (frame_idx - f_start) / (f_end - f_start) * 100
                elapsed = time.time() - t0
                eta     = elapsed / max(pct, 0.1) * (100 - pct)
                r = result
                print(
                    f"  [{pct:5.1f}%] frame {frame_idx}/{f_end}  ETA:{eta:.0f}s  "
                    f"cyc={r.total_cyclists} ped={r.total_pedestrians} "
                    f"car={r.total_cars} mot={r.total_motorcycles}",
                    end="\r",
                )
    finally:
        cap.release()
        if writer:
            writer.release()

    elapsed = time.time() - t0
    r = result

    stats = {
        "video": video_path,
        "resolution": f"{width}x{height}",
        "fps": fps,
        "frames_processed": frame_idx - f_start,
        "duration_processed_s": round((frame_idx - f_start) / fps, 2),
        "processing_time_s": round(elapsed, 2),
        "speed_x_realtime": round((frame_idx - f_start) / fps / elapsed, 2),
        "totals": {
            "cyclists":    r.total_cyclists    if r else 0,
            "pedestrians": r.total_pedestrians if r else 0,
            "cars":        r.total_cars        if r else 0,
            "motorcycles": r.total_motorcycles if r else 0,
        },
        "directions": {
            "cyclists":    {"in": r.cyc_in, "out": r.cyc_out} if r else {},
            "pedestrians": {"in": r.ped_in, "out": r.ped_out} if r else {},
            "cars":        {"in": r.car_in, "out": r.car_out} if r else {},
            "motorcycles": {"in": r.mot_in, "out": r.mot_out} if r else {},
        },
        "events": events,
    }

    Path(output_json).write_text(json.dumps(stats, indent=2, ensure_ascii=False))

    print(f"\n\n{'─'*52}")
    print(f"  Cyclists    : {stats['totals']['cyclists']}")
    print(f"  Pedestrians : {stats['totals']['pedestrians']}")
    print(f"  Cars        : {stats['totals']['cars']}")
    print(f"  Motorcycles : {stats['totals']['motorcycles']}")
    print(f"{'─'*52}")
    print(f"  Processing   : {elapsed:.1f}s "
          f"({stats['speed_x_realtime']}× real time)")
    if output_video:
        print(f"  Annotated    : {output_video}")
        size = Path(output_video).stat().st_size / 1_048_576
        print(f"  Size         : {size:.1f} MB")
    print(f"  JSON         : {output_json}")

    return stats


def main():
    p = argparse.ArgumentParser(
        description="Counts cyclists, pedestrians, cars and motorcycles in a video"
    )
    p.add_argument("--video",    default="Andradas.mp4")
    p.add_argument("--output",   default=None,            help="Annotated output video")
    p.add_argument("--json",     default="result.json")
    p.add_argument("--no-video", action="store_true",     help="Do not save the annotated video")
    p.add_argument("--start",    type=float, default=0,   metavar="SECONDS")
    p.add_argument("--end",      type=float, default=None, metavar="SECONDS")
    args = p.parse_args()

    output_video = None
    if not args.no_video:
        output_video = args.output or Path(args.video).stem + "_annotated.mp4"

    process(
        video_path=args.video,
        output_video=output_video,
        output_json=args.json,
        start_s=args.start,
        end_s=args.end,
    )


if __name__ == "__main__":
    main()
