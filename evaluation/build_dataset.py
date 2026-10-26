#!/usr/bin/env python3
"""
Builds the fine-tuning dataset from this camera's videos:

1. Selects frames from the daytime hours (bicycles/motorcycles guaranteed on
   the event frames + random ones for background/cars).
2. Auto-labels with yolov8x @1280 (high quality).
3. Generates an augmented version with directional MOTION BLUR applied only
   inside the boxes of moving objects (simulates the night blur with a sharp
   background).

Remapped classes: person→0 bicycle→1 car→2 motorcycle→3 bus→4 truck→5

Output (YOLO format): evaluation/dataset/{images,labels}/{train,val}/ + data.yaml
"""
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy
from exact_frames import exact_frames

random.seed(42)

ROOT = Path(__file__).resolve().parent
# per-hour events of the v9 sweep (sweep_all.py output; old name varredura_v9)
SWEEP = legacy.first_existing(ROOT / "sweep_v9", ROOT / "varredura_v9")
TRAIN_HOURS = ["06", "08", "09", "10", "11", "13", "14", "15", "16"]
REMAP = {0: 0, 1: 1, 2: 2, 3: 3, 5: 4, 7: 5}
NAMES = ["person", "bicycle", "car", "motorcycle", "bus", "truck"]


def pick_frames(hour: str) -> list[int]:
    evs = legacy.load_events(SWEEP / f"diag_{hour}")
    frames = set()
    cyc = [e["video_frame"] for e in evs if e["category"] == "cyclists"]
    mot = [e["video_frame"] for e in evs if e["category"] == "motorcycles"]
    ped = [e["video_frame"] for e in evs if e["category"] == "pedestrians"]
    for f in cyc:                                 # every frame with a bike
        frames.update([f - 8, f, f + 8])
    for f in random.sample(mot, min(70, len(mot))):
        frames.update([f - 6, f])
    for f in random.sample(ped, min(15, len(ped))):
        frames.add(f)
    frames.update(random.sample(range(500, 53000), 25))   # background/cars
    return sorted(f for f in frames if 0 < f < 53500)


def directional_blur(img, boxes, ksize):
    """Applies horizontal motion blur inside the boxes (with a margin)."""
    k = np.zeros((ksize, ksize), np.float32)
    k[ksize // 2, :] = 1.0 / ksize
    out = img.copy()
    for (x1, y1, x2, y2) in boxes:
        m = 12
        x1, y1 = max(0, int(x1) - m), max(0, int(y1) - m)
        x2, y2 = min(img.shape[1], int(x2) + m), min(img.shape[0], int(y2) + m)
        if x2 - x1 < 8 or y2 - y1 < 8:
            continue
        out[y1:y2, x1:x2] = cv2.filter2D(img[y1:y2, x1:x2], -1, k)
    return out


NIGHT_HOURS = ["19", "20", "21", "22", "23"]


def pick_night_frames(hour: str) -> list[int]:
    """Night frames: pedestrian/car events (objects that stay sharp at
    night) + random ones — teach the dark domain without labeling blur."""
    evs = legacy.load_events(SWEEP / f"diag_{hour}")
    frames = set()
    ped = [e["video_frame"] for e in evs if e["category"] == "pedestrians"]
    car = [e["video_frame"] for e in evs if e["category"] == "cars"]
    for f in random.sample(ped, min(20, len(ped))):
        frames.add(f)
    for f in random.sample(car, min(12, len(car))):
        frames.add(f)
    frames.update(random.sample(range(500, 53000), 8))
    return sorted(f for f in frames if 0 < f < 53500)


def main():
    out = ROOT / "dataset"
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    model = YOLO("yolov8x.pt")
    n_img = 0
    for hour in TRAIN_HOURS:
        video = ROOT / f"videos/Andradas_{hour}.mp4"
        targets = pick_frames(hour)
        print(f"[{hour}] {len(targets)} frames", flush=True)
        for idx, fr in exact_frames(str(video), targets):
            r = model(fr, conf=0.40, imgsz=1280, classes=list(REMAP),
                      agnostic_nms=True, verbose=False)[0]
            if len(r.boxes) == 0:
                continue
            h, w = fr.shape[:2]
            rows, moving_boxes = [], []
            for b in r.boxes:
                cls = REMAP[int(b.cls[0])]
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                cxn, cyn = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
                wn, hn = (x2 - x1) / w, (y2 - y1) / h
                rows.append(f"{cls} {cxn:.5f} {cyn:.5f} {wn:.5f} {hn:.5f}")
                moving_boxes.append((x1, y1, x2, y2))
            split = "val" if random.random() < 0.12 else "train"
            name = f"{hour}_{idx:06d}"
            cv2.imwrite(str(out / f"images/{split}/{name}.jpg"), fr,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out / f"labels/{split}/{name}.txt").write_text("\n".join(rows))
            n_img += 1

            # version with synthetic blur (train only)
            if split == "train":
                ksize = random.choice([13, 19, 25, 31, 37])
                fb = directional_blur(fr, moving_boxes, ksize)
                cv2.imwrite(str(out / f"images/train/{name}_blur.jpg"), fb,
                            [cv2.IMWRITE_JPEG_QUALITY, 92])
                (out / f"labels/train/{name}_blur.txt").write_text(
                    "\n".join(rows))
                n_img += 1
        print(f"[{hour}] accumulated: {n_img} images", flush=True)

    # night frames (labeled with a higher conf; no synthetic blur — the real
    # night blur is already on the fast objects, which stay UNLABELED and so
    # teach nothing wrong)
    for hour in NIGHT_HOURS:
        video = ROOT / f"videos/Andradas_{hour}.mp4"
        targets = pick_night_frames(hour)
        print(f"[night {hour}] {len(targets)} frames", flush=True)
        for idx, fr in exact_frames(str(video), targets):
            r = model(fr, conf=0.50, imgsz=1280, classes=list(REMAP),
                      agnostic_nms=True, verbose=False)[0]
            h, w = fr.shape[:2]
            rows = []
            for b in r.boxes:
                cls = REMAP[int(b.cls[0])]
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                rows.append(f"{cls} {(x1+x2)/2/w:.5f} {(y1+y2)/2/h:.5f} "
                            f"{(x2-x1)/w:.5f} {(y2-y1)/h:.5f}")
            # also include night frames WITHOUT objects (negatives)
            split = "val" if random.random() < 0.12 else "train"
            name = f"n{hour}_{idx:06d}"
            cv2.imwrite(str(out / f"images/{split}/{name}.jpg"), fr,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out / f"labels/{split}/{name}.txt").write_text("\n".join(rows))
            n_img += 1

    (out / "data.yaml").write_text(
        f"path: {out}\ntrain: images/train\nval: images/val\n"
        f"names:\n" + "\n".join(f"  {i}: {n}" for i, n in enumerate(NAMES)) + "\n")
    print(f"dataset ready: {n_img} images in {out}", flush=True)


if __name__ == "__main__":
    main()
