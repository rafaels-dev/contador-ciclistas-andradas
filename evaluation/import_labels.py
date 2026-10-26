#!/usr/bin/env python3
"""
Imports rotulos_andradas.json (exported by Cristiano's labeling app) and
turns the bicycle positives into training examples:

  - for each candidate labeled "bicicleta", extracts the center frame at
    full resolution and tries to get the bicycle BOX by running the FT
    model at minimum confidence (0.01) and picking the bicycle detection
    closest to the candidate position;
  - writes image + YOLO label to evaluation/dataset/images|labels/train
    (prefix "cr_"), including ALL the objects in the frame labeled by
    yolov8x (so the other objects are not taught as background);
  - "bicicleta" candidates WITHOUT a recoverable box go to
    evaluation/mining/no_box.json (label the box by hand later).

Then run: python evaluation/train_finetune.py

Usage: python evaluation/import_labels.py path/rotulos_andradas.json
"""
import json
import sys
from pathlib import Path

import cv2
from ultralytics import YOLO

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy
from exact_frames import exact_frames

ROOT = Path(__file__).resolve().parent
MINING = legacy.mining_dir(ROOT)
REMAP = {0: 0, 1: 1, 2: 2, 3: 3, 5: 4, 7: 5}


def main():
    labels_path = Path(sys.argv[1])
    # external file in Portuguese: {"rotulos": {candidate id: "bicicleta" | "moto" | ...}}
    labels = json.loads(labels_path.read_text(encoding="utf-8"))["rotulos"]
    cands = {c["id"]: c for c in legacy.load_mined_candidates(MINING)}

    positives = [cands[i] for i, l in labels.items()
                 if l == "bicicleta" and i in cands]
    print(f"{len(positives)} candidates labeled as bicycle")

    ft = YOLO(ROOT.parent / "runs/ft_blur/weights/best.pt")
    x = YOLO("yolov8x.pt")
    out_img = ROOT / "dataset/images/train"
    out_lbl = ROOT / "dataset/labels/train"
    no_box = []
    n_ok = 0

    by_hour = {}
    for c in positives:
        by_hour.setdefault(c["hour"], []).append(c)

    for hour, items in sorted(by_hour.items()):
        video = str(ROOT / f"videos/Andradas_{hour}.mp4")
        target_by_frame = {c["frame"]: c for c in items}
        for f, fr in exact_frames(video, list(target_by_frame)):
            c = target_by_frame[f]
            h, w = fr.shape[:2]

            # bicycle box: FT model at minimum conf, closest to the
            # candidate position
            r = ft(fr, conf=0.01, imgsz=640, classes=[1], verbose=False)[0]
            target_cx = ((c["box"][0] + c["box"][2]) / 2 if c.get("box")
                         else 960.0)
            target_cy = ((c["box"][1] + c["box"][3]) / 2 if c.get("box")
                         else float(c.get("y", 700)))
            best, best_d = None, 1e9
            for b in r.boxes:
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                d = abs((x1 + x2) / 2 - target_cx) + abs((y1 + y2) / 2 - target_cy)
                if d < best_d:
                    best_d, best = d, (x1, y1, x2, y2)
            if best is None or best_d > 400:
                no_box.append(c["id"])
                continue

            # other objects in the frame (labeled by yolov8x)
            rows = []
            rx = x(fr, conf=0.40, imgsz=1280, classes=list(REMAP),
                   agnostic_nms=True, verbose=False)[0]
            for b in rx.boxes:
                cls = REMAP[int(b.cls[0])]
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                if cls == 1:
                    continue   # bicycles in the frame: we only use the confirmed one
                rows.append(f"{cls} {(x1+x2)/2/w:.5f} {(y1+y2)/2/h:.5f} "
                            f"{(x2-x1)/w:.5f} {(y2-y1)/h:.5f}")
            bx1, by1, bx2, by2 = best
            rows.append(f"1 {(bx1+bx2)/2/w:.5f} {(by1+by2)/2/h:.5f} "
                        f"{(bx2-bx1)/w:.5f} {(by2-by1)/h:.5f}")

            name = f"cr_{c['id']}"
            cv2.imwrite(str(out_img / f"{name}.jpg"), fr,
                        [cv2.IMWRITE_JPEG_QUALITY, 92])
            (out_lbl / f"{name}.txt").write_text("\n".join(rows))
            n_ok += 1
        print(f"[{hour}] ok", flush=True)

    (MINING / "no_box.json").write_text(json.dumps(no_box))
    print(f"{n_ok} examples added to the dataset; "
          f"{len(no_box)} without a recoverable box ({MINING.name}/no_box.json)")
    print("Now run: python evaluation/train_finetune.py")


if __name__ == "__main__":
    main()
