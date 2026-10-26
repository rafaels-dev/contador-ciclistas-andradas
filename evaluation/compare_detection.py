#!/usr/bin/env python3
"""
Compares detection settings (model, imgsz, conf) on frames sampled from a
video. Reports the mean number of detections per frame per relevant COCO class.

Usage:
    python evaluation/compare_detection.py evaluation/videos/Andradas_21.mp4 --n 120
"""
import argparse
import json
from collections import defaultdict

import cv2
from ultralytics import YOLO

CLASSES = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

CONFIGS = [
    ("yolov8n.pt", 640, 0.40),   # current
    ("yolov8n.pt", 1280, 0.40),
    ("yolov8n.pt", 1280, 0.25),
    ("yolov8s.pt", 1280, 0.40),
    ("yolov8s.pt", 1280, 0.25),
    ("yolov8m.pt", 1280, 0.25),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--n", type=int, default=120)
    args = p.parse_args()

    cap = cv2.VideoCapture(args.video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    idxs = [int(i * total / args.n) for i in range(args.n)]
    frames = []
    for ix in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, ix)
        ok, fr = cap.read()
        if ok:
            frames.append(fr)
    cap.release()
    print(f"{len(frames)} frames sampled from {args.video}")

    results = {}
    for model, imgsz, conf in CONFIGS:
        m = YOLO(model)
        counts = defaultdict(int)
        import time
        t0 = time.time()
        for fr in frames:
            r = m(fr, conf=conf, imgsz=imgsz, classes=list(CLASSES),
                  verbose=False)[0]
            for c in r.boxes.cls.tolist():
                counts[CLASSES[int(c)]] += 1
        dt = (time.time() - t0) / len(frames) * 1000
        key = f"{model}@{imgsz} conf={conf}"
        results[key] = {"ms_per_frame": round(dt, 1),
                        **{k: round(v / len(frames), 3)
                           for k, v in sorted(counts.items())}}
        print(key, json.dumps(results[key]))

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
