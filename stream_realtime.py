#!/usr/bin/env python3
"""
Real-time streaming — 4 counters: cyclists, pedestrians, cars, motorcycles.

Supports:
  - RTSP stream (rtsp://user:password@192.168.1.10/stream)
  - MP4 file    (Andradas.mp4)
  - Webcam      (integer index: 0, 1, …)

Output on stdout: newline-delimited JSON (pipe into Kafka, MQTT, a database).

Usage:
    python stream_realtime.py rtsp://192.168.1.100/cam4 --cam-id CAM4
    python stream_realtime.py Andradas.mp4
    python stream_realtime.py 0 --no-window
    python stream_realtime.py rtsp://... --skip 1   # processes 1 of every 2 frames
"""

import argparse
import json
import os
import signal
import sys
import time

import cv2

from counter import TrafficCounter, annotate_frame

WINDOW = "Traffic Counter"


def has_display() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def publish(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def process_stream(
    source: str,
    cam_id: str = "CAM",
    show_window: bool = True,
    window_width: int = 1280,
    window_height: int = 720,
    skip_frames: int = 0,
    line_x: int | None = None,
) -> None:
    try:
        source = int(source)
    except (ValueError, TypeError):
        pass

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        sys.exit(f"Error: could not open '{source}'")

    if isinstance(source, str) and source.startswith("rtsp"):
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 15
    width      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    display = show_window and has_display()
    if display:
        cv2.namedWindow(WINDOW, cv2.WINDOW_RESIZABLE)
        cv2.resizeWindow(WINDOW, window_width, window_height)

    counter = TrafficCounter(line_x=line_x)

    stop = False

    def _quit(sig, frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _quit)
    signal.signal(signal.SIGTERM, _quit)

    publish({
        "event": "start",
        "cam_id": cam_id,
        "resolution": f"{width}x{height}",
        "fps": source_fps,
        "timestamp": time.time(),
    })
    print(f"Stream: '{source}'  {width}x{height} @ {source_fps:.1f}fps", flush=True)

    frame_num = 0
    last_heartbeat = time.time()
    result = None

    _CATS = [
        ("cyclists",    lambda r: (r.new_cyclists,    r.total_cyclists,    r.cyc_in, r.cyc_out)),
        ("pedestrians", lambda r: (r.new_pedestrians, r.total_pedestrians, r.ped_in, r.ped_out)),
        ("cars",        lambda r: (r.new_cars,        r.total_cars,        r.car_in, r.car_out)),
        ("motorcycles", lambda r: (r.new_motorcycles, r.total_motorcycles, r.mot_in, r.mot_out)),
    ]

    while not stop:
        ok, frame = cap.read()
        if not ok:
            if isinstance(source, str) and source.startswith("rtsp"):
                print("Stream lost, reconnecting in 3 s...", flush=True)
                time.sleep(3)
                cap.open(source)
                continue
            break

        frame_num += 1

        if skip_frames > 0 and frame_num % (skip_frames + 1) != 0:
            if display:
                cv2.imshow(WINDOW, cv2.resize(frame, (window_width, window_height)))
                if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                    break
            continue

        result = counter.process(frame)
        r = result

        for cat, fn in _CATS:
            new, total, n_in, n_out = fn(r)
            if new > 0:
                publish({
                    "event": "count",
                    "cam_id": cam_id,
                    "category": cat,
                    "frame": frame_num,
                    "total": total,
                    "in": n_in,
                    "out": n_out,
                    "timestamp": time.time(),
                })

        now = time.time()
        if now - last_heartbeat >= 30:
            publish({
                "event": "heartbeat",
                "cam_id": cam_id,
                "cyclists":    r.total_cyclists,
                "pedestrians": r.total_pedestrians,
                "cars":        r.total_cars,
                "motorcycles": r.total_motorcycles,
                "timestamp": now,
            })
            last_heartbeat = now

        if display:
            lx = line_x if line_x is not None else width // 2
            annotated = annotate_frame(frame, result, lx)
            cv2.imshow(WINDOW, cv2.resize(annotated, (window_width, window_height)))
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break

    cap.release()
    if display:
        cv2.destroyAllWindows()

    r = result
    publish({
        "event": "shutdown",
        "cam_id": cam_id,
        "cyclists":    r.total_cyclists    if r else 0,
        "pedestrians": r.total_pedestrians if r else 0,
        "cars":        r.total_cars        if r else 0,
        "motorcycles": r.total_motorcycles if r else 0,
        "frames_processed": frame_num,
        "timestamp": time.time(),
    })


def main():
    p = argparse.ArgumentParser(
        description="Real-time counter: cyclists, pedestrians, cars and motorcycles"
    )
    p.add_argument("source",      nargs="?", default="Andradas.mp4",
                   help="RTSP URL, video file or webcam index")
    p.add_argument("--cam-id",    default="CAM")
    p.add_argument("--no-window", action="store_true")
    p.add_argument("--skip",      type=int, default=0, metavar="N",
                   help="Processes 1 of every N+1 frames (lowers CPU load)")
    p.add_argument("--line-x",    type=int, default=None)
    args = p.parse_args()

    process_stream(
        source=args.source,
        cam_id=args.cam_id,
        show_window=not args.no_window,
        skip_frames=args.skip,
        line_x=args.line_x,
    )


if __name__ == "__main__":
    main()
