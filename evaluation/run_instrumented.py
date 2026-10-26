#!/usr/bin/env python3
"""
Diagnostic runner: runs the TrafficCounter on a video and writes:

  - events.jsonl : every count with frame, category, direction, reason
                   (entry/centroid/reid_opposite/...), tid, bbox and cx
  - tracks.json  : summarized trajectory of each track (first/last frame,
                   initial/final/min/max cx) — to detect wrong counts and
                   missed crossings
  - summary.json : totals per category/direction/reason
  - snapshots/   : annotated JPG of each count event (sampled)

Usage:
    python evaluation/run_instrumented.py --video evaluation/videos/Andradas_07.mp4 \
        --output evaluation/diag_07 [--start 0] [--end 600] [--max-snapshots 300]
"""
import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
from counter import TrafficCounter

CATS = ["cyclists", "pedestrians", "cars", "motorcycles"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--start", type=float, default=0, help="seconds")
    p.add_argument("--end", type=float, default=None, help="seconds")
    p.add_argument("--max-snapshots", type=int, default=300,
                   help="maximum snapshots PER CATEGORY")
    p.add_argument("--model", default=None)
    p.add_argument("--conf", type=float, default=None)
    p.add_argument("--imgsz", type=int, default=None)
    args = p.parse_args()

    output = Path(args.output)
    (output / "snapshots").mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"could not open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    f_start = int(args.start * fps)
    f_end = int(args.end * fps) if args.end else n_frames
    if f_start:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_start)

    kw = {}
    if args.model:
        kw["model"] = args.model
    if args.conf:
        kw["confidence"] = args.conf
    if args.imgsz:
        kw["imgsz"] = args.imgsz
    counter = TrafficCounter(**kw)

    # (cat, tid) -> trajectory summary
    tracks: dict = {}
    events_out = open(output / "events.jsonl", "w", encoding="utf-8")
    n_events_seen = {c: 0 for c in CATS}
    n_snapshots = {c: 0 for c in CATS}

    frame_i = f_start
    t0 = time.time()
    while frame_i < f_end:
        ok, frame = cap.read()
        if not ok:
            break
        r = counter.process(frame)

        dets_by_cat = {
            "cyclists": r.cyclists, "pedestrians": r.pedestrians,
            "cars": r.cars, "motorcycles": r.motorcycles,
        }

        # trajectories
        for cat, det in dets_by_cat.items():
            if len(det) == 0 or det.tracker_id is None:
                continue
            for k, tid in enumerate(det.tracker_id):
                cx = float((det.xyxy[k, 0] + det.xyxy[k, 2]) / 2)
                cy = float((det.xyxy[k, 1] + det.xyxy[k, 3]) / 2)
                key = (cat, int(tid))
                t = tracks.get(key)
                if t is None:
                    tracks[key] = {
                        "f0": frame_i, "f1": frame_i, "cx0": cx, "cx1": cx,
                        "cxmin": cx, "cxmax": cx, "cy1": cy, "n": 1,
                    }
                else:
                    t["f1"] = frame_i
                    t["cx1"] = cx
                    t["cy1"] = cy
                    t["cxmin"] = min(t["cxmin"], cx)
                    t["cxmax"] = max(t["cxmax"], cx)
                    t["n"] += 1

        # new events in this iteration
        for cat, line in counter.lines.items():
            evs = line.events
            while n_events_seen[cat] < len(evs):
                ev = dict(evs[n_events_seen[cat]])
                n_events_seen[cat] += 1
                ev["category"] = cat
                ev["video_frame"] = frame_i
                ev["time_s"] = round(frame_i / fps, 2)
                det = dets_by_cat[cat]
                bbox = None
                if len(det) and det.tracker_id is not None:
                    hit = np.where(det.tracker_id == ev["tid"])[0]
                    if len(hit):
                        bbox = [round(float(v), 1) for v in det.xyxy[hit[0]]]
                ev["bbox"] = bbox
                events_out.write(json.dumps(ev, ensure_ascii=False) + "\n")

                if n_snapshots[cat] < args.max_snapshots:
                    n_snapshots[cat] += 1
                    img = frame.copy()
                    cv2.line(img, (config.LINE_X, 0), (config.LINE_X, img.shape[0]),
                             (0, 0, 255), 2)
                    if bbox:
                        x1, y1, x2, y2 = [int(v) for v in bbox]
                        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 3)
                    label = f"{cat} tid={ev['tid']} {ev['reason']} {ev['side']} f={frame_i}"
                    cv2.putText(img, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX,
                                1.0, (0, 255, 255), 2)
                    img = cv2.resize(img, (960, 540))
                    name = f"{cat}_{frame_i:06d}_tid{ev['tid']}_{ev['reason']}.jpg"
                    cv2.imwrite(str(output / "snapshots" / name), img,
                                [cv2.IMWRITE_JPEG_QUALITY, 80])

        frame_i += 1
        if (frame_i - f_start) % 900 == 0:
            el = time.time() - t0
            done = frame_i - f_start
            print(f"[{done}/{f_end - f_start}] {done / el:.1f} fps  "
                  f"cyc={r.total_cyclists} ped={r.total_pedestrians} "
                  f"car={r.total_cars} mot={r.total_motorcycles}", flush=True)

    cap.release()
    events_out.close()

    r_final = r
    summary = {
        "video": args.video,
        "frames": [f_start, frame_i],
        "processing_fps": round((frame_i - f_start) / (time.time() - t0), 1),
        "totals": {
            "cyclists": r_final.total_cyclists,
            "pedestrians": r_final.total_pedestrians,
            "cars": r_final.total_cars,
            "motorcycles": r_final.total_motorcycles,
        },
        "directions": {
            "cyclists": {"in": r_final.cyc_in, "out": r_final.cyc_out},
            "pedestrians": {"in": r_final.ped_in, "out": r_final.ped_out},
            "cars": {"in": r_final.car_in, "out": r_final.car_out},
            "motorcycles": {"in": r_final.mot_in, "out": r_final.mot_out},
        },
        "by_reason": {},
    }
    for cat, line in counter.lines.items():
        reasons = defaultdict(int)
        for ev in line.events:
            reasons[ev["reason"]] += 1
        summary["by_reason"][cat] = dict(reasons)

    tracks_ser = [
        {"cat": cat, "tid": tid, **t} for (cat, tid), t in tracks.items()
    ]
    (output / "tracks.json").write_text(json.dumps(tracks_ser))
    (output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False),
                                         encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
