#!/usr/bin/env python3
"""
Detection + tracking for the review app (web/).

Unlike counter/ (which decides the count online, frame by frame, with a fixed
vertical line), here the whole video is processed first and the decision is
made on the COMPLETE TRAJECTORIES — which allows counting lines at any angle
and leaves the final word to the human review.

Step 1 (sequential): same models as the counter (COCO + fine-tuned
  bicycles), 4 ByteTracks (persons, bicycles, cars, motorcycles). Each track
  keeps its per-frame boxes, class votes, person↔bicycle/motorcycle
  association and a few crops (for the filmstrip).
  In parallel, background subtraction: moving blobs that no YOLO box
  explains become a 5th ByteTrack ("motion" → category other) — everything
  that moves and crosses the line reaches the review, even with no model.
Post-processing: generates candidates
  - with lines: first crossing of the ground-contact point (bottom-center of
    the box) with each drawn segment; direction A→B / B→A.
  - without lines: every trajectory with a relevant displacement.
  A person associated with a bicycle/motorcycle that also produced a
  candidate is the cyclist/rider → dropped (the vehicle already represents
  the object).
Step 2 (sequential): one short H.264 clip per candidate, cropped around the
  object, with the box and the lines drawn.

Usage:
  python worker/detect.py --video V.mp4 --output DIR [--lines lines.json]
                          [--start S] [--end S]
Output: DIR/candidates.json, DIR/filmstrips/*.jpg, DIR/clips/*.mp4 and, on
stdout, one JSON line per event ({"type": "progress"|"done"|"error"}).

IMPORTANT: no cap.set(POS_FRAMES) — seeking in these DVR files lands ~30 s
before the request (see CLAUDE.md). Everything is read sequentially.
"""
from __future__ import annotations

import argparse
import bisect
import gzip
import json
import os
import sys

# JSON events carry "→" and "…": on Windows stdout starts as cp1252
if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
import time
import warnings
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

warnings.filterwarnings("ignore", category=FutureWarning, module="supervision")
import supervision as sv  # noqa: E402
from ultralytics import YOLO  # noqa: E402

import config  # noqa: E402
from reader import VideoReader, area_to_px, video_info, write_jpg  # noqa: E402

_PERSON, _BICYCLE, _MOTORCYCLE = 0, 1, 3

GROUPS = ("ped", "bike", "car", "moto", "motion")
GROUP_CATEGORY = {"ped": "pedestrians", "bike": "cyclists", "car": "cars", "moto": "motorcycles",
                  "motion": "other"}

TRACKS_VERSION = 3       # 2: includes the "motion" group; 3: TRACK_GROW. Older tracks force a new detection
                         # (meta["area"]: the analyzed crop; tracks of another area too)
MIN_OBS = 3              # minimum observations (after splicing) to become a candidate
MAX_CROPS = 10           # crops kept per track (filmstrip)
MIN_SHIFT_FRAC = 0.12    # no lines: minimum displacement (fraction of the diagonal)
PAIR_WINDOW_S = 3.0      # person↔vehicle: events within ±3 s are the same object
CLIP_S = 1.5             # clip half-window (s)

# motion without a model (background subtraction on a downscaled copy of the frame)
MOTION_WIDTH = 480       # width of the motion mask (px)
MOTION_AREA_MIN = 40     # minimum blob area on the mask (px; ~25×25 at 1080p)
MOTION_AREA_MAX = 0.25   # blob larger than this fraction of the frame = exposure/IR switch, ignored
MOTION_EXPLAINED = 0.3   # fraction of the blob inside YOLO boxes → already a known object
MOTION_WARMUP_S = 3.0    # the background model needs a few seconds to settle
MOTION_MIN_S = 0.6       # motion track: minimum duration
MOTION_SHIFT_HEIGHTS = 1.5  # ... and minimum displacement, in heights of its own box
# ... unless it is fast: a blob that covers this much (px at 1080p) in fewer
# frames is a vehicle YOLO missed, not a leaf. Andradas h17: a blurred cyclist
# filling half the frame (1084 px in 10 frames, 9 between the first and the
# last) and the motorcycle behind it (1267 px in 7) were both dropped
MOTION_FAST_SHIFT = 500
MOTION_FAST_MIN_OBS = 5
MOTION_REPEATED_OVERLAP = 0.5  # motion box this much inside a YOLO event's box (of the smaller) ...
MOTION_REPEATED_S = 0.2        # ... crossing at the same moment = the same object. A moto/cyclist beside
                               # the car also falls inside its box, but crosses 10–14 frames apart
# Inside the analysis area the mask is fine (down to 1 px of 4K) and noise
# gets through: 10–20 px blobs (compression, sun through the leaves) that the
# tracker chains into a "trajectory" that barely moves. Measured in px of a
# 1080p frame (÷ scale). Augusto de Lima (06h, area 768×468): the 30 discarded
# ones had p90 area < 1100 or moved < 110; cyclists, pedestrians and scooters,
# p90 ≥ 1900 and ≥ 160.
MOTION_FINE_VERSION = 3     # bump when detection inside the area changes (old tracks are redone)
# ByteTrack confirms a NEW track only when IoU × confidence between two frames
# is > 0.3 (hard-coded in supervision). A fast object with a narrow box never
# gets there: the Andradas cyclist at ~130 px/frame with a ~280 px person box
# gives IoU ~0.36 × 0.65 ≈ 0.23 — every frame opens an id that dies, and no
# trajectory forms (h17: 7 of 8 cyclists in Cristiano's labels). The boxes are
# enlarged by this factor only for the tracker (IoU ~0.6) and shrunk back.
# Not for cars: neighbors in a platoon would swap ids.
TRACK_GROW = 2.0
TRACK_GROW_GROUPS = ("ped", "bike", "moto", "motion")
MOTION_FINE_AREA_P90 = 1000  # px²: the object must reach this size at some point
MOTION_FINE_SHIFT = 120     # px: minimum displacement from start to end
LANE_WIDTH = 3.0         # line that does not count cars (bike lane, sidewalk): an object whose
                         # length along the crossing direction is > 3× the line does not fit in
                         # the lane (car/bus in the next lane whose base invades the bike lane)


def emit(**data) -> None:
    print(json.dumps(data, ensure_ascii=False), flush=True)


@dataclass
class Track:
    group: str
    tid: int
    frames: list[int] = field(default_factory=list)
    boxes: list[tuple[float, float, float, float]] = field(default_factory=list)
    classes: Counter = field(default_factory=Counter)
    conf_sum: float = 0.0
    crops: list[tuple[int, bytes]] = field(default_factory=list)
    crop_step: int = 1
    # association (persons only): frames with a bicycle/motorcycle nearby and which tracks
    n_bike: int = 0
    n_moto: int = 0
    neighbors: Counter = field(default_factory=Counter)
    splices: list[str] = field(default_factory=list)  # keys of the spliced pieces

    @property
    def key(self) -> str:
        return f"{self.group}:{self.tid}"

    @property
    def n(self) -> int:
        return len(self.frames)

    def associated(self) -> str | None:
        """Same criteria as the counter (v5/v7)."""
        if self.group != "ped":
            return None
        if self.n_moto >= 2 and self.n_moto / self.n >= 0.5:
            return "moto"
        if self.n_bike / self.n >= 0.3 or (self.n_bike >= 2 and self.n <= 10):
            return "bike"
        return None


# ----------------------------------------------------------------------
# Geometry
# ----------------------------------------------------------------------

def _side(a, b, p) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def crossing(a, b, p, q) -> float | None:
    """Fraction t∈[0,1] along p→q at which the motion crosses segment a–b,
    or None. Same side convention as the UI: side A has cross < 0."""
    d1, d2 = _side(a, b, p), _side(a, b, q)
    if d1 == 0 or d1 * d2 > 0:
        return None
    d3, d4 = _side(p, q, a), _side(p, q, b)
    if d3 * d4 > 0:
        return None
    return d1 / (d1 - d2)


def ground_point(box) -> tuple[float, float]:
    x1, _, x2, y2 = box
    return ((x1 + x2) / 2, y2)


# ----------------------------------------------------------------------
# Step 1
# ----------------------------------------------------------------------

def _crop(frame, box, group: str) -> bytes:
    h_img, w_img = frame.shape[:2]
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    top = h * (1.2 if group in ("bike", "moto") else 0.25)  # includes the rider
    x1, x2 = x1 - w * 0.25, x2 + w * 0.25
    y1, y2 = y1 - top, y2 + h * 0.15
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w_img, int(x2)), min(h_img, int(y2))
    img = frame[y1:y2, x1:x2]
    scale = 200 / max(img.shape[:2])
    if scale < 1:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes() if ok else b""


def _grown(xyxy: np.ndarray, k: float) -> np.ndarray:
    """Boxes scaled by k around their centers."""
    c = (xyxy[:, :2] + xyxy[:, 2:]) / 2
    half = (xyxy[:, 2:] - xyxy[:, :2]) * (k / 2)
    return np.hstack([c - half, c + half])


def track_update(tracker, dets: sv.Detections, grow: float = 1.0) -> sv.Detections:
    """ByteTrack over boxes enlarged by `grow` (see TRACK_GROW); the result
    comes back with the original boxes."""
    if grow == 1.0 or not len(dets):
        return tracker.update_with_detections(dets)
    big = dets[np.arange(len(dets))]  # a copy: the caller's boxes stay as they are
    big.xyxy = _grown(dets.xyxy.astype(np.float64), grow)
    out = tracker.update_with_detections(big)
    if len(out):
        out.xyxy = _grown(out.xyxy.astype(np.float64), 1 / grow).astype(dets.xyxy.dtype)
    return out


def _record(tracks: dict, group: str, dets: sv.Detections, frame, idx: int,
            keep_crops: bool = True) -> None:
    if not len(dets) or dets.tracker_id is None:
        return
    for k, tid in enumerate(dets.tracker_id):
        key = f"{group}:{int(tid)}"
        tr = tracks.get(key)
        if tr is None:
            tr = tracks[key] = Track(group, int(tid))
        box = tuple(float(v) for v in dets.xyxy[k])
        tr.frames.append(idx)
        tr.boxes.append(box)
        if dets.class_id is not None:
            tr.classes[int(dets.class_id[k])] += 1
        if dets.confidence is not None:
            tr.conf_sum += float(dets.confidence[k])
        if keep_crops and (tr.n - 1) % tr.crop_step == 0:
            tr.crops.append((idx, _crop(frame, box, group)))
            if len(tr.crops) > MAX_CROPS:
                tr.crops = tr.crops[::2]
                tr.crop_step *= 2


def _associate(tracks: dict, persons, bicycles, motos, scale: float) -> None:
    """Person ↔ bicycle/motorcycle, anisotropic (|dx|≤120, |dy|≤250 at 1080p):
    the rider sits ~200 px above the vehicle's center."""
    if not len(persons) or persons.tracker_id is None:
        return
    dx_max, dy_max = 120 * scale, 250 * scale
    pc = np.column_stack([(persons.xyxy[:, 0] + persons.xyxy[:, 2]) / 2,
                          (persons.xyxy[:, 1] + persons.xyxy[:, 3]) / 2])
    for group, veh in (("bike", bicycles), ("moto", motos)):
        if not len(veh) or veh.tracker_id is None:
            continue
        vc = np.column_stack([(veh.xyxy[:, 0] + veh.xyxy[:, 2]) / 2,
                              (veh.xyxy[:, 1] + veh.xyxy[:, 3]) / 2])
        for i, ptid in enumerate(persons.tracker_id):
            dx = np.abs(vc[:, 0] - pc[i, 0])
            dy = np.abs(vc[:, 1] - pc[i, 1])
            near = np.where((dx <= dx_max) & (dy <= dy_max))[0]
            if not len(near):
                continue
            tr = tracks[f"ped:{int(ptid)}"]
            if group == "bike":
                tr.n_bike += 1
            else:
                tr.n_moto += 1
            j = near[np.argmin(dx[near] + dy[near])]
            tr.neighbors[f"{group}:{int(veh.tracker_id[j])}"] += 1


class Motion:
    """Moving blobs not explained by YOLO, as sv.Detections in the processed
    frame space. Shadows (MOG2 marks them 127) are left out — except inside
    the analysis area (`fine`): there the object is small and blurred (the
    distant cyclist on Augusto de Lima), and MOG2 marks most of it as shadow;
    what remains breaks into pieces. Counting the shadow and closing with a
    larger kernel makes it a single blob again."""

    def __init__(self, width: int, height: int, fps: float, s: float | None = None, fine: bool = False):
        self.s = s or MOTION_WIDTH / width
        self.fine = fine
        self.threshold = 100 if fine else 200
        self.size = (max(1, int(round(width * self.s))), max(1, int(round(height * self.s))))
        self.background = cv2.createBackgroundSubtractorMOG2(history=int(20 * fps), varThreshold=25,
                                                             detectShadows=True)
        self.warmup = int(MOTION_WARMUP_S * fps)
        self.n = 0
        self.k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11) if fine else (7, 7))

    def detect(self, frame, known: list[sv.Detections]) -> sv.Detections:
        small = cv2.resize(frame, self.size, interpolation=cv2.INTER_AREA)
        mask = self.background.apply(small)
        self.n += 1
        if self.n <= self.warmup:
            return sv.Detections.empty()
        _, m = cv2.threshold(mask, self.threshold, 255, cv2.THRESH_BINARY)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, self.k_open)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, self.k_close)
        # Inside the analysis area (high camera), the box of the car in the
        # lane next to the curb drops onto the bike lane: enlarged, it
        # "explained" the cyclist beside it, and both blobs came out merged.
        # There, a car counts only through its tight box, and what is inside
        # it leaves the mask (Augusto de Lima 81 and 117 min: the cyclist glued
        # to the car becomes a candidate again).
        tight = self.fine
        if tight:
            for d in known:
                if not len(d):
                    continue
                for (x1, y1, x2, y2), c in zip(d.xyxy * self.s, d.class_id):
                    if c in config.CAR_CLASSES:
                        m[max(0, int(y1)):int(y2), max(0, int(x1)):int(x2)] = 0
        n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        if n <= 1:
            return sv.Detections.empty()
        # YOLO boxes, enlarged sideways and downwards (wheels, legs, attached
        # shadow): a blob mostly inside them already has a model
        cover = np.zeros(m.shape, np.uint8)
        for d in known:
            if not len(d):
                continue
            for (x1, y1, x2, y2), c in zip(d.xyxy * self.s, d.class_id):
                w, h = x2 - x1, y2 - y1
                if tight and c in config.CAR_CLASSES:
                    continue
                cv2.rectangle(cover, (int(x1 - 0.3 * w), int(y1 - 0.1 * h)),
                              (int(x2 + 0.3 * w), int(y2 + 0.5 * h)), 1, -1)
        inside = np.bincount(labels[cover > 0], minlength=n)
        area_max = MOTION_AREA_MAX * m.size
        boxes = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if area < MOTION_AREA_MIN or area > area_max or inside[i] / area >= MOTION_EXPLAINED:
                continue
            boxes.append((x, y, x + w, y + h))
        if not boxes:
            return sv.Detections.empty()
        xyxy = np.array(boxes, np.float32) / self.s
        return sv.Detections(xyxy=xyxy, confidence=np.full(len(xyxy), 0.5, np.float32),
                             class_id=np.full(len(xyxy), -1, int))


# box colors in the preview (BGR; the same as COLOR in render.py)
PREVIEW_COLOR = {"ped": (240, 130, 61), "bike": (98, 191, 47), "car": (32, 123, 244),
                 "moto": (234, 75, 210), "motion": (147, 154, 160)}


def write_preview(target: Path, frame, tracked: dict, motion, lines: list[dict]) -> None:
    """The frame being analyzed, with the boxes and the lines: the page shows
    it during detection, so the user can see it is moving along."""
    img = frame.copy()
    h, w = img.shape[:2]
    thick = max(2, round(w / 640))
    for l in lines:
        cv2.line(img, (round(l["x1"] * w), round(l["y1"] * h)), (round(l["x2"] * w), round(l["y2"] * h)),
                 (21, 204, 250), thick + 1, cv2.LINE_AA)
    for g, d in [*tracked.items(), ("motion", motion)]:
        for x1, y1, x2, y2 in d.xyxy:
            cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), PREVIEW_COLOR[g], thick)
    if w > 1280:
        img = cv2.resize(img, (1280, round(h * 1280 / w)), interpolation=cv2.INTER_AREA)
    tmp = target.with_suffix(".tmp")
    write_jpg(tmp, img, 75)
    try:
        os.replace(tmp, target)
    except OSError:
        pass  # Windows: the server is reading the previous one — next time


def detection_step(video: str, start_f: int, end_f: int | None,
                   forced_imgsz: int | None = None, batch: int = 8, area=None,
                   preview: Path | None = None, preview_lines: list[dict] = ()):
    """Returns (tracks, scale, reader). Coordinates in the processed frame
    space (≤ 1920 px wide, or the area crop; see reader.py). With `preview`,
    writes a JPEG of the current frame there every second."""
    model = YOLO(str(ROOT / config.MODEL) if (ROOT / config.MODEL).exists() else config.MODEL)
    mb = getattr(config, "BICYCLE_MODEL", None)
    bike_model = YOLO(str(ROOT / mb)) if mb else None
    conf, iou = config.CONFIDENCE, config.IOU
    classes = sorted({_PERSON, _BICYCLE, _MOTORCYCLE, *config.CAR_CLASSES})
    trackers = {g: sv.ByteTrack() for g in GROUPS}

    def by_class(d: sv.Detections, ids) -> sv.Detections:
        if not len(d):
            return d
        return d[np.isin(d.class_id, ids)]

    reader = VideoReader(video, area=area)
    scale = scale_of(reader)
    # motion mask: inside the crop it is finer (up to 960 px) — it is the same
    # small object that motivated the crop
    motion = Motion(reader.width, reader.height, reader.info["fps"],
                    s=min(1.0, 960 / reader.width) if area else None, fine=bool(area))
    imgsz = forced_imgsz
    if imgsz is None and area:
        # the crop is already at the resolution that matters: inference at its
        # size (up to 1280; YOLO upscales smaller crops, which helps)
        imgsz = min(1280, max(640, int(round(max(reader.width, reader.height) / 32)) * 32))
    elif imgsz is None:
        # inference resolution follows the ORIGINAL video: at 4K, 640 px
        # shrinks the frame 6× and small objects (cyclists in a high view)
        # vanish; 1080p → 640, 4K → 1280
        base = getattr(config, "IMGSZ", 640)
        imgsz = int(round(base * max(1.0, reader.info["height"] / 1080) / 32) * 32)
    emit(type="progress", stage="detecting", p=0, imgsz=imgsz, nvdec=reader.gpu)
    if preview is not None:
        preview.unlink(missing_ok=True)  # one from a previous detection (another area)

    tracks: dict[str, Track] = {}
    total_f = reader.info["frames"]
    target = (end_f if end_f is not None else total_f) - start_f
    idx = -1
    while idx + 1 < start_f and reader.skip():
        idx += 1
    t0 = time.time()
    last_emit = 0.0
    finished = False

    while not finished:
        # batched inference: the GPU idles with one frame per call
        frames, indices = [], []
        while len(frames) < batch:
            if end_f is not None and idx + 1 >= end_f:
                finished = True
                break
            f = reader.read()
            if f is None:
                finished = True
                break
            idx += 1
            frames.append(f)
            indices.append(idx)
        if not frames:
            break

        rs = model(frames, conf=conf, iou=iou, imgsz=imgsz, classes=classes,
                   agnostic_nms=True, verbose=False)
        rbs = (bike_model(frames, conf=conf, iou=iou, imgsz=imgsz, classes=[_BICYCLE], verbose=False)
               if bike_model is not None else [None] * len(frames))

        for frame, i, r, rb in zip(frames, indices, rs, rbs):
            everything = sv.Detections.from_ultralytics(r)
            bikes = sv.Detections.from_ultralytics(rb) if rb is not None else by_class(everything, [_BICYCLE])
            if rb is not None and area:
                # the fine-tuned model is from the Andradas camera (side view);
                # on Augusto de Lima (high, 4K) it catches nothing and COCO does
                coco = by_class(everything, [_BICYCLE])
                if len(coco):
                    bikes = sv.Detections.merge([bikes, coco]).with_nms(threshold=0.5, class_agnostic=True) if len(bikes) else coco
            motos = by_class(everything, config.MOTORCYCLE_CLASSES)
            if area and len(motos):
                # COCO alternates bicycle/motorcycle on the same small cyclist;
                # with one tracker per class, neither formed a trajectory.
                # Inside the area, two-wheelers are a single group — the
                # vision model decides the class
                bikes = sv.Detections.merge([bikes, motos]).with_nms(threshold=0.5, class_agnostic=True) if len(bikes) else motos
                motos = sv.Detections.empty()
            raw = {"ped": by_class(everything, [_PERSON]), "bike": bikes,
                   "car": by_class(everything, config.CAR_CLASSES), "moto": motos}
            tracked = {g: track_update(trackers[g], d, TRACK_GROW if g in TRACK_GROW_GROUPS else 1.0)
                       for g, d in raw.items()}
            for g, d in tracked.items():
                # filmstrip crops come from the 2nd pass (media_step), only for
                # the candidates — no need to keep them for every track
                _record(tracks, g, d, frame, i, keep_crops=False)
            _associate(tracks, tracked["ped"], tracked["bike"], tracked["moto"], scale)
            # only boxes that are part of a trajectory explain a blob: a raw
            # box the tracker never confirms (fast cyclist, flickering person)
            # used to erase the blob too, and the object vanished altogether.
            # A blob of an object YOLO tracks a moment later is dropped later
            # (coincides with the YOLO event on the same line)
            mov = motion.detect(frame, list(tracked.values()))
            _record(tracks, "motion", track_update(trackers["motion"], mov, TRACK_GROW), frame, i,
                    keep_crops=False)

        now = time.time()
        if now - last_emit >= 1.0:
            last_emit = now
            if preview is not None:
                write_preview(preview, frame, tracked, mov, preview_lines)
            done = idx + 1 - start_f
            emit(type="progress", stage="detecting",
                 p=min(done / target, 1.0) if target > 0 else 0,
                 fps=round(done / (now - t0), 1), frame=idx)
    reader.close()
    if preview is not None:  # a single file, overwritten; removed when detection ends
        preview.unlink(missing_ok=True)
        preview.with_suffix(".tmp").unlink(missing_ok=True)
    return tracks, scale, reader


# ----------------------------------------------------------------------
# Trajectory splicing
# ----------------------------------------------------------------------

def scale_of(reader) -> float:
    """Pixel density relative to a full 1080p frame: the worker's px limits
    (association, splicing, clips) were tuned on it. On a native-resolution
    4K crop, an object has 2× the pixels → scale 2."""
    return reader.info["height"] / (reader.factor * 1080)


def lines_in_frame(lines: list[dict], meta: dict) -> list[dict]:
    """Lines (0–1 of the original frame) → 0–1 of the processed frame (the area)."""
    area = meta.get("area")
    if not area:
        return lines
    W, H = meta["original"]
    ox, oy, w, h = area
    return [{**l, "x1": (l["x1"] * W - ox) / w, "y1": (l["y1"] * H - oy) / h,
             "x2": (l["x2"] * W - ox) / w, "y2": (l["y2"] * H - oy) / h} for l in lines]


def box_in_original(c, meta: dict) -> list[float]:
    ox, oy = (meta.get("area") or (0, 0))[:2]
    f = meta["factor"]
    return [round(ox + c[0] * f, 1), round(oy + c[1] * f, 1), round(ox + c[2] * f, 1), round(oy + c[3] * f, 1)]


def _velocity(tr: Track, last: int = 6) -> tuple[float, float]:
    """px/frame of the ground point over the last observations."""
    k = min(last, tr.n - 1)
    if k < 1:
        return 0.0, 0.0
    p0, p1 = ground_point(tr.boxes[-1 - k]), ground_point(tr.boxes[-1])
    df = max(1, tr.frames[-1] - tr.frames[-1 - k])
    return (p1[0] - p0[0]) / df, (p1[1] - p0[1]) / df


def splice_tracks(tracks: dict, fps: float, scale: float) -> dict:
    """ByteTrack sometimes loses the object for a few frames (occlusion,
    blur) and picks it up again with a NEW id — if that happens right on the
    line, neither piece crosses it. Splices B into A when B is born up to
    ~2 s after A dies, in the same group, close to where A would be following
    its velocity (replaces centroid_gap/reid_opposite from counter/line.py)."""
    max_gap = int(2.0 * fps)
    by_group: dict[str, list[Track]] = {}
    for tr in tracks.values():
        by_group.setdefault(tr.group, []).append(tr)

    parent: dict[str, str] = {}  # key B → key A (B continues A)
    for group_tracks in by_group.values():
        group_tracks.sort(key=lambda t: t.frames[0])
        ends = sorted(group_tracks, key=lambda t: t.frames[-1])
        has_successor: set[str] = set()
        for b in group_tracks:
            best, best_d = None, None
            pb = ground_point(b.boxes[0])
            for a in ends:
                gap = b.frames[0] - a.frames[-1]
                if gap > max_gap:
                    continue
                if gap <= 0:
                    break  # ends are sorted: the rest also overlap B
                if a.key in has_successor or a.n < 2:
                    continue
                vx, vy = _velocity(a)
                pa = ground_point(a.boxes[-1])
                predicted = (pa[0] + vx * gap, pa[1] + vy * gap)
                height = a.boxes[-1][3] - a.boxes[-1][1]
                tol = max(80 * scale, 0.6 * height) + 0.5 * np.hypot(vx, vy) * gap
                d = np.hypot(pb[0] - predicted[0], pb[1] - predicted[1])
                if d <= tol and (best_d is None or d < best_d):
                    best, best_d = a, d
            if best is not None:
                parent[b.key] = best.key
                has_successor.add(best.key)

    def root(key: str) -> str:
        while key in parent:
            key = parent[key]
        return key

    chains: dict[str, list[Track]] = {}
    for tr in tracks.values():
        chains.setdefault(root(tr.key), []).append(tr)

    result: dict[str, Track] = {}
    for parts in chains.values():
        parts.sort(key=lambda t: t.frames[0])
        if len(parts) == 1:
            result[parts[0].key] = parts[0]
            continue
        new = Track(parts[0].group, parts[0].tid)
        for p in parts:
            new.frames += p.frames
            new.boxes += p.boxes
            new.classes += p.classes
            new.conf_sum += p.conf_sum
            new.crops += p.crops
            new.n_bike += p.n_bike
            new.n_moto += p.n_moto
            new.neighbors += p.neighbors
        while len(new.crops) > MAX_CROPS:
            new.crops = new.crops[::2]
        new.splices = [p.key for p in parts]
        result[new.key] = new

    # person neighbors point to old keys of spliced vehicles
    for tr in result.values():
        if tr.neighbors:
            tr.neighbors = Counter({root(k): v for k, v in tr.neighbors.items()})
    return result


# ----------------------------------------------------------------------
# Track persistence (lets candidates be redone when the lines change,
# without repeating the detection)
# ----------------------------------------------------------------------

def save_tracks(path: Path, tracks: dict, meta: dict) -> None:
    items = [{
        "group": t.group, "tid": t.tid, "frames": t.frames,
        "boxes": [[round(v, 1) for v in c] for c in t.boxes],
        "classes": dict(t.classes), "conf_sum": round(t.conf_sum, 3),
        "n_bike": t.n_bike, "n_moto": t.n_moto, "neighbors": dict(t.neighbors), "splices": t.splices,
    } for t in tracks.values() if t.n >= MIN_OBS]
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump({"meta": meta, "tracks": items}, f)


def load_tracks(path: Path) -> tuple[dict, dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    tracks = {}
    for d in data["tracks"]:
        t = Track(d["group"], d["tid"], frames=d["frames"], boxes=[tuple(c) for c in d["boxes"]],
                  classes=Counter({int(k): v for k, v in d["classes"].items()}), conf_sum=d["conf_sum"],
                  n_bike=d["n_bike"], n_moto=d["n_moto"], neighbors=Counter(d["neighbors"]), splices=d["splices"])
        tracks[t.key] = t
    return tracks, data["meta"]


def save_points(path: Path, tracks: dict, meta: dict, max_per_group: int = 4000) -> None:
    """Sampled ground points per category (0–1 coordinates of the original
    frame) — the line editor shows where each kind of object really passes."""
    W, H = meta["original"]
    ox, oy = (meta.get("area") or (0, 0))[:2]
    f = meta["factor"]
    by_group: dict[str, list] = {}
    for t in tracks.values():
        if t.n < MIN_OBS:
            continue
        g = t.associated() or t.group
        step = max(1, t.n // 12)
        for c in t.boxes[::step]:
            x, y = ground_point(c)
            by_group.setdefault(GROUP_CATEGORY[g], []).append([round((ox + x * f) / W, 4), round((oy + y * f) / H, 4)])
    rng = np.random.default_rng(0)
    for g, pts in by_group.items():
        if len(pts) > max_per_group:
            by_group[g] = [pts[i] for i in sorted(rng.choice(len(pts), max_per_group, replace=False))]
    path.write_text(json.dumps(by_group), encoding="utf-8")


# ----------------------------------------------------------------------
# Candidates
# ----------------------------------------------------------------------

def _real_motion(tr: Track, fps: float, scale: float = 1.0, fine: bool = False) -> bool:
    """Background-subtraction-only track: it has to last and really move
    (leaves, rain and blinking headlights stay in place). Inside the analysis
    area (`fine`), it also needs an object's size and a minimum distance."""
    heights = sorted(c[3] - c[1] for c in tr.boxes)
    p0, p1 = ground_point(tr.boxes[0]), ground_point(tr.boxes[-1])
    shift = np.hypot(p1[0] - p0[0], p1[1] - p0[1])
    fast = len(tr.frames) >= MOTION_FAST_MIN_OBS and shift >= MOTION_FAST_SHIFT * scale
    if tr.frames[-1] - tr.frames[0] < MOTION_MIN_S * fps and not fast:
        return False
    if shift < MOTION_SHIFT_HEIGHTS * heights[len(heights) // 2]:
        return False
    if fine:
        areas = [(c[2] - c[0]) * (c[3] - c[1]) for c in tr.boxes]
        if np.percentile(areas, 90) < MOTION_FINE_AREA_P90 * scale ** 2 or shift < MOTION_FINE_SHIFT * scale:
            return False
    return True


def _too_wide(tr: Track, j: int, a, b) -> bool:
    """Box length along the line's normal (median around the crossing)
    larger than LANE_WIDTH × the line length."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = max(1e-6, (dx * dx + dy * dy) ** 0.5)
    nx, ny = abs(dy) / L, abs(dx) / L
    ext = sorted(nx * (c[2] - c[0]) + ny * (c[3] - c[1]) for c in tr.boxes[max(0, j - 3):j + 4])
    return ext[len(ext) // 2] > LANE_WIDTH * L


def generate_candidates(tracks: dict, lines: list[dict], width: int, height: int,
                        fps: float, scale: float, fine: bool = False) -> list[dict]:
    segs = [(l["id"], (l["x1"] * width, l["y1"] * height), (l["x2"] * width, l["y2"] * height))
            for l in lines]
    lane_only = {l["id"] for l in lines
                 if l.get("categories") and "cars" not in l["categories"]}
    diag = (width ** 2 + height ** 2) ** 0.5
    events: list[dict] = []

    for tr in tracks.values():
        if tr.n < MIN_OBS:
            continue
        if tr.group == "motion" and not _real_motion(tr, fps, scale, fine):
            continue
        base = {"track": tr.key, "group": tr.group, "_tr": tr}
        if segs:
            pts = [ground_point(c) for c in tr.boxes]
            for lid, a, b in segs:
                for i in range(tr.n - 1):
                    t = crossing(a, b, pts[i], pts[i + 1])
                    if t is None:
                        continue
                    j = i if t < 0.5 else i + 1
                    if lid in lane_only and _too_wide(tr, j, a, b):
                        break
                    events.append({**base, "line_id": lid,
                                   "frame": int(round(tr.frames[i] + t * (tr.frames[i + 1] - tr.frames[i]))),
                                   "direction": "A→B" if _side(a, b, pts[i]) < 0 else "B→A",
                                   "bbox": tr.boxes[j]})
                    break  # one candidate per track and line
        else:
            p0, p1 = ground_point(tr.boxes[0]), ground_point(tr.boxes[-1])
            if np.hypot(p1[0] - p0[0], p1[1] - p0[1]) < MIN_SHIFT_FRAC * diag:
                continue
            j = tr.n // 2
            events.append({**base, "line_id": None, "frame": tr.frames[j],
                           "direction": None, "bbox": tr.boxes[j]})

    # Person associated with a bicycle/motorcycle: if the vehicle also produced
    # an event on the same line and close in time, it is the rider/pillion →
    # dropped. Without a vehicle event (detection failed), the person stays,
    # but the YOLO suggestion becomes the vehicle's.
    window = PAIR_WINDOW_S * fps
    vehicles = [ev for ev in events if ev["group"] in ("bike", "moto")]
    final = []
    for ev in events:
        tr: Track = ev["_tr"]
        assoc = tr.associated()
        ev["origin"] = "track"
        if assoc:
            neighbors = {k for k, _ in tr.neighbors.most_common(5)}
            cx = (ev["bbox"][0] + ev["bbox"][2]) / 2
            pair = [v for v in vehicles if v["line_id"] == ev["line_id"]
                    and abs(v["frame"] - ev["frame"]) <= window
                    and (v["track"] in neighbors
                         or abs((v["bbox"][0] + v["bbox"][2]) / 2 - cx) <= 150 * scale)]
            if pair:
                continue
            ev["suggested_group"] = assoc
            ev["origin"] = "person_on_" + ("bicycle" if assoc == "bike" else "motorcycle")
        final.append(ev)

    # bicycle × motorcycle on the same object (COCO mixes up two-wheelers):
    # the longer track stays, with the other class recorded as an alternative
    final.sort(key=lambda e: e["frame"])
    removed = set()
    for i, a in enumerate(final):
        if a["group"] not in ("bike", "moto") or id(a) in removed:
            continue
        for b in final[i + 1:]:
            if b["frame"] - a["frame"] > 0.5 * fps * 2:
                break
            if ({a["group"], b["group"]} != {"bike", "moto"} or b["line_id"] != a["line_id"]
                    or id(b) in removed):
                continue
            if abs((a["bbox"][0] + a["bbox"][2]) / 2 - (b["bbox"][0] + b["bbox"][2]) / 2) > 150 * scale:
                continue
            keep, drop = (a, b) if a["_tr"].n >= b["_tr"].n else (b, a)
            keep["alternative"] = GROUP_CATEGORY[drop["group"]]
            removed.add(id(drop))
    final = [e for e in final if id(e) not in removed]

    # motion that coincides with a YOLO event (same line, close in time and
    # space) is the same object seen before/after the model caught it. Close
    # in space: near centers, or boxes that mostly overlap at the same moment —
    # a fast car's blob is a piece of it (or MOG2's trail), off-center from the
    # ~900 px box (Andradas h17: 20 cars counted twice once fast blobs were kept)
    known = [e for e in final if e["group"] != "motion"]
    def _overlap(a, b) -> float:
        w = min(a[2], b[2]) - max(a[0], b[0])
        h = min(a[3], b[3]) - max(a[1], b[1])
        if w <= 0 or h <= 0:
            return 0.0
        return w * h / min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    def _repeated(ev) -> bool:
        cx = (ev["bbox"][0] + ev["bbox"][2]) / 2
        return any(c["line_id"] == ev["line_id"] and abs(c["frame"] - ev["frame"]) <= fps
                   and (abs((c["bbox"][0] + c["bbox"][2]) / 2 - cx) <= 150 * scale
                        or (abs(c["frame"] - ev["frame"]) <= MOTION_REPEATED_S * fps
                            and _overlap(c["bbox"], ev["bbox"]) >= MOTION_REPEATED_OVERLAP)) for c in known)
    for ev in final:
        if ev["group"] == "motion":
            ev["origin"] = "motion"
    final = [e for e in final if e["group"] != "motion" or not _repeated(e)]

    for k, ev in enumerate(final):
        tr = ev["_tr"]
        ev["id"] = k
        ev["time_s"] = round(ev["frame"] / fps, 2)
        ev["yolo_class"] = GROUP_CATEGORY[ev.get("suggested_group", ev["group"])]
        ev["yolo_conf"] = round(tr.conf_sum / tr.n, 3)
        ev["n_obs"] = tr.n
        ev["bbox"] = [round(v, 1) for v in ev["bbox"]]
    return final


def save_filmstrip(tr: Track, target: Path, n: int = 5) -> None:
    crops = tr.crops
    if not crops:
        return
    pos = np.linspace(0, len(crops) - 1, min(n, len(crops))).round().astype(int)
    imgs = []
    h, w_max = 160, 480
    for p in pos:
        img = cv2.imdecode(np.frombuffer(crops[p][1], np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        # each crop fits in w_max×h: very wide motion blobs (the whole curb at
        # dawn) became 8–14 thousand px strips, and the vision model rejects
        # images with a side > 8000 px ("Provider returned error")
        scale = min(h / img.shape[0], w_max / img.shape[1])
        img = cv2.resize(img, (max(1, round(img.shape[1] * scale)), max(1, round(img.shape[0] * scale))))
        if img.shape[0] < h:
            pad = h - img.shape[0]
            img = cv2.copyMakeBorder(img, pad // 2, pad - pad // 2, 0, 0, cv2.BORDER_CONSTANT, value=(32, 32, 32))
        imgs.append(img)
        imgs.append(np.full((h, 4, 3), 32, np.uint8))
    if imgs:
        write_jpg(target, np.hstack(imgs[:-1]))


# ----------------------------------------------------------------------
# Step 2: candidate media (clips, contexts, filmstrips)
# ----------------------------------------------------------------------

def _clip_region(tr: Track, f0: int, f1: int, width: int, height: int, scale: float):
    cxs = [c for f, c in zip(tr.frames, tr.boxes) if f0 <= f <= f1] or tr.boxes
    x1 = min(c[0] for c in cxs); y1 = min(c[1] for c in cxs)
    x2 = max(c[2] for c in cxs); y2 = max(c[3] for c in cxs)
    pad = max(160 * scale, 0.5 * (y2 - y1))
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(width, x2 + pad), min(height, y2 + pad)
    w, h = x2 - x1, y2 - y1
    s = min(360 / h, 640 / w)
    ow, oh = int(w * s) // 2 * 2, int(h * s) // 2 * 2
    return int(x1), int(y1), int(x2), int(y2), max(ow, 2), max(oh, 2)


def _box_at(tr: Track, idx: int):
    """The track's box at frame idx, interpolated between neighboring
    observations when it fell into a tracking gap (the crossing often falls
    between two detections; without a box, the vision model does not know
    which object it is)."""
    k = bisect.bisect_left(tr.frames, idx)
    if k < tr.n and tr.frames[k] == idx:
        return tr.boxes[k]
    if k == 0 or k == tr.n:
        return None
    f0, f1 = tr.frames[k - 1], tr.frames[k]
    t = (idx - f0) / (f1 - f0)
    return [a + t * (b - a) for a, b in zip(tr.boxes[k - 1], tr.boxes[k])]


def media_step(video: str, candidates: list[dict], lines: list[dict], output: Path,
               fps: float, width: int, height: int, scale: float, n_crops: int = 5,
               area=None) -> None:
    import imageio_ffmpeg

    clips_dir = output / "clips"
    half = int(CLIP_S * fps)
    pending = sorted(candidates, key=lambda c: c["frame"] - half)
    if not pending:
        return
    # frames each filmstrip crop comes from (spread along the trajectory)
    crops_at: dict[int, list] = {}
    for tr in {id(c["_tr"]): c["_tr"] for c in candidates}.values():  # once per track
        tr.crops = []
        for k in np.linspace(0, tr.n - 1, min(n_crops, tr.n)).round().astype(int):
            crops_at.setdefault(tr.frames[k], []).append((tr, tr.boxes[k]))
    segs = [((l["x1"] * width, l["y1"] * height), (l["x2"] * width, l["y2"] * height)) for l in lines]
    active: list[dict] = []
    next_i = 0
    last_f = max(max(c["frame"] for c in pending) + half, max(crops_at))
    reader = VideoReader(video, area=area)
    idx = -1
    last_emit = 0.0
    while idx < last_f:
        idx += 1
        while next_i < len(pending) and pending[next_i]["frame"] - half <= idx:
            c = pending[next_i]
            next_i += 1
            tr: Track = c["_tr"]
            f0, f1 = c["frame"] - half, c["frame"] + half
            x1, y1, x2, y2, ow, oh = _clip_region(tr, f0, f1, width, height, scale)
            w = imageio_ffmpeg.write_frames(
                str(clips_dir / f"{c['id']}.mp4"), (ow, oh), fps=fps, codec="libx264",
                pix_fmt_in="bgr24", pix_fmt_out="yuv420p", macro_block_size=2,
                output_params=["-preset", "veryfast", "-crf", "28", "-movflags", "+faststart"])
            w.send(None)
            active.append({"c": c, "w": w, "end": f1, "reg": (x1, y1, x2, y2, ow, oh), "tr": tr})
        if not active and idx not in crops_at:
            if not reader.skip():
                break
            continue
        frame = reader.read()
        if frame is None:
            break
        for tr, box in crops_at.get(idx, ()):
            tr.crops.append((idx, _crop(frame, box, tr.group)))
        for a in list(active):
            x1, y1, x2, y2, ow, oh = a["reg"]
            img = frame[y1:y2, x1:x2].copy()
            sx, sy = ow / max(1, x2 - x1), oh / max(1, y2 - y1)
            img = cv2.resize(img, (ow, oh), interpolation=cv2.INTER_AREA)
            for pa, pb in segs:
                cv2.line(img, (int((pa[0] - x1) * sx), int((pa[1] - y1) * sy)),
                         (int((pb[0] - x1) * sx), int((pb[1] - y1) * sy)), (0, 220, 255), 2)
            box = _box_at(a["tr"], idx)
            if box is not None:
                color = (0, 0, 255) if idx >= a["c"]["frame"] else (0, 255, 0)
                cv2.rectangle(img, (int((box[0] - x1) * sx), int((box[1] - y1) * sy)),
                              (int((box[2] - x1) * sx), int((box[3] - y1) * sy)), color, 2)
            a["w"].send(np.ascontiguousarray(img))
            if idx == a["c"]["frame"]:
                # event frame with the box and the lines: context for the vision
                # model (which lane the object is in; at night the crop says little)
                write_jpg(output / "contexts" / f"{a['c']['id']}.jpg", img)
            if idx >= a["end"]:
                a["w"].close()
                active.remove(a)
        now = time.time()
        if now - last_emit >= 1.0:
            last_emit = now
            emit(type="progress", stage="clips", p=min(idx / max(last_f, 1), 1.0), frame=idx)
    for a in active:
        a["w"].close()
    reader.close()
    for c in candidates:
        save_filmstrip(c["_tr"], output / "filmstrips" / f"{c['id']}.jpg")


# ----------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--output", required=True, help="candidates folder (media + candidates.json)")
    ap.add_argument("--tracks", help="trajectories .json.gz file (default: <output>/../tracks.json.gz)")
    ap.add_argument("--lines", help="JSON with a list of lines {id,name,x1,y1,x2,y2,categories} (0–1)")
    ap.add_argument("--stage", choices=["all", "tracks", "candidates"], default="all",
                    help="tracks = detection only; candidates = only redo from the saved tracks")
    ap.add_argument("--start", type=float, default=0.0, help="start second (tests)")
    ap.add_argument("--end", type=float, default=None, help="end second (tests)")
    ap.add_argument("--imgsz", type=int, default=None, help="inference resolution (default: from the video height)")
    ap.add_argument("--area", help="analysis area x,y,w,h (0–1 of the frame); the rest of the frame is ignored")
    args = ap.parse_args()

    output = Path(args.output)
    tracks_file = Path(args.tracks) if args.tracks else output.parent / "tracks.json.gz"
    lines = json.loads(Path(args.lines).read_text(encoding="utf-8")) if args.lines else []
    info = video_info(args.video)
    fps = info["fps"]
    area = area_to_px(tuple(float(v) for v in args.area.split(",")) if args.area else None,
                      info["width"], info["height"])

    tracks = None
    if args.stage == "candidates":
        tracks, meta = load_tracks(tracks_file)
        if meta.get("version", 1) < TRACKS_VERSION:
            tracks = None  # old detection (no motion): redo everything
        elif tuple(meta.get("area") or ()) != tuple(area or ()):
            tracks = None  # another analysis area: the detection is different
        elif area and meta.get("motion_fine", 1) < MOTION_FINE_VERSION:
            tracks = None  # area detected before the tight car boxes: redo
    if tracks is None:
        start_f = int(args.start * fps)
        end_f = int(args.end * fps) if args.end is not None else None
        preview_lines = lines_in_frame(lines, {"area": area, "original": [info["width"], info["height"]]})
        tracks, scale, reader = detection_step(args.video, start_f, end_f, args.imgsz, area=area,
                                               preview=output.parent / "preview.jpg",
                                               preview_lines=preview_lines)
        tracks = splice_tracks(tracks, fps, scale)
        meta = {"fps": fps, "width": reader.width, "height": reader.height,
                "factor": reader.factor, "scale": scale, "version": TRACKS_VERSION,
                "area": list(area) if area else None, "area_arg": args.area if area else None,
                "motion_fine": MOTION_FINE_VERSION,
                "original": [info["width"], info["height"]]}
        save_tracks(tracks_file, tracks, meta)
        (tracks_file.parent / "tracks_meta.json").write_text(json.dumps(meta), encoding="utf-8")
        save_points(tracks_file.parent / "points.json", tracks, meta)
        if args.stage == "tracks":
            emit(type="done", tracks=len(tracks))
            return
    width, height, scale = meta["width"], meta["height"], meta["scale"]  # processed frame space
    meta.setdefault("original", [info["width"], info["height"]])
    lines_q = lines_in_frame(lines, meta)

    for sub in ("filmstrips", "contexts", "clips"):
        (output / sub).mkdir(parents=True, exist_ok=True)
    candidates = generate_candidates(tracks, lines_q, width, height, fps, scale, fine=bool(meta.get("area")))
    emit(type="progress", stage="clips", p=0, candidates=len(candidates))
    media_step(args.video, candidates, lines_q, output, fps, width, height, scale,
               area=tuple(meta["area"]) if meta.get("area") else None)

    fields = ("id", "track", "line_id", "frame", "time_s", "direction", "bbox",
              "yolo_class", "yolo_conf", "alternative", "origin", "n_obs")
    out = []
    for c in candidates:
        d = {k: c.get(k) for k in fields}
        d["bbox"] = box_in_original(c["bbox"], meta)  # px of the original video
        d["filmstrip"] = f"filmstrips/{c['id']}.jpg"
        d["clip"] = f"clips/{c['id']}.mp4"
        d["context"] = f"contexts/{c['id']}.jpg"
        out.append(d)
    (output / "candidates.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    emit(type="done", candidates=len(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the app shows the message on the job
        emit(type="error", message=f"{type(e).__name__}: {e}")
        raise
