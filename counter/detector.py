"""
Counter core — 4 independent categories.

A single YOLO inference per frame detects every class (class-agnostic NMS:
avoids a double car+truck box on the same vehicle).

CYCLISTS are counted from the `bicycle` class itself (dedicated tracker +
line, like motorcycles/cars) — project decision: vehicles carrying bicycles
almost never pass here, so every bicycle that crosses is a cyclist.

PERSONS are tracked in a single tracker and each track accumulates, frame by
frame, how often a bicycle (bike association) or motorcycle (moto
association) was nearby (≤ max_dist px). When it crosses the line, a person
counts as a PEDESTRIAN only if the track is NOT bike-associated (that's the
cyclist, already counted through the bicycle) nor moto-associated
(rider/pillion, already counted through the motorcycle). Per-track (not
per-frame) classification prevents double counting when the bicycle
detection flickers.

Cars (car+bus+truck) and motorcycles keep their own trackers and lines.
CountingLine uses centroid + re-ID (see line.py).
"""

from __future__ import annotations

import time
import warnings
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import supervision as sv
from ultralytics import YOLO

warnings.filterwarnings("ignore", category=FutureWarning, module="supervision")

import config
from .line import CountingLine

# COCO classes
_PERSON     = 0
_BICYCLE    = 1
_CAR        = 2
_MOTORCYCLE = 3
_BUS        = 5
_TRUCK      = 7

_ALL_CLASSES = sorted(
    set(config.CYCLIST_CLASSES
        + config.PEDESTRIAN_CLASSES
        + config.CAR_CLASSES
        + config.MOTORCYCLE_CLASSES)
)


class _Tally:
    """Simple per-category counter (same in_count/out_count/events interface
    as CountingLine)."""

    def __init__(self):
        self.in_count = 0
        self.out_count = 0
        self.events: list[dict] = []

    def record(self, side: str, event: dict) -> None:
        if side == "left":
            self.in_count += 1
        else:
            self.out_count += 1
        self.events.append(event)


class _CombinedTally:
    """Summed view of two counters (e.g. bicycles + fallback cyclists)."""

    def __init__(self, *parts):
        self._parts = parts

    @property
    def in_count(self):
        return sum(p.in_count for p in self._parts)

    @property
    def out_count(self):
        return sum(p.out_count for p in self._parts)

    @property
    def events(self):
        evs = [e for p in self._parts for e in p.events]
        evs.sort(key=lambda e: e.get("frame", 0))
        return evs


@dataclass
class FrameResult:
    # Detections per category (for on-screen boxes)
    cyclists:    sv.Detections
    pedestrians: sv.Detections
    cars:        sv.Detections
    motorcycles: sv.Detections

    # Running totals
    total_cyclists:    int
    total_pedestrians: int
    total_cars:        int
    total_motorcycles: int

    # Running directions (in / out)
    cyc_in: int;  cyc_out: int
    ped_in: int;  ped_out: int
    car_in: int;  car_out: int
    mot_in: int;  mot_out: int

    # Newly counted in this frame (for the event flash)
    new_cyclists:    int
    new_pedestrians: int
    new_cars:        int
    new_motorcycles: int

    timestamp: float = field(default_factory=time.time)

    @property
    def grand_total(self) -> int:
        return (self.total_cyclists + self.total_pedestrians
                + self.total_cars + self.total_motorcycles)


class TrafficCounter:
    """
    Real-time multi-category counter for fixed cameras.

    Usage:
        counter = TrafficCounter()
        result = counter.process(frame)
    """

    def __init__(
        self,
        model: str = config.MODEL,
        confidence: float = config.CONFIDENCE,
        iou: float = config.IOU,
        line_x: Optional[int] = None,
        line_y_start: int = config.LINE_Y_START,
        line_y_end:   int = config.LINE_Y_END,
        roi_y_min: int = config.ROI_Y_MIN,
        roi_y_max: int = config.ROI_Y_MAX,
        max_cyclist_dist_px: int = config.MAX_CYCLIST_DIST_PX,
        imgsz: int = getattr(config, "IMGSZ", 640),
        bicycle_model: str | None = getattr(config, "BICYCLE_MODEL", None),
    ):
        self._confidence = confidence
        self._iou        = iou
        self._imgsz      = imgsz
        self._roi_y      = (roi_y_min, roi_y_max)
        self._line_x_config = line_x
        self._line_y     = (line_y_start, line_y_end)
        self._max_dist   = max_cyclist_dist_px

        self._model = YOLO(model)
        # Dedicated bicycle model (fine-tuned with this camera's synthetic
        # blur): replaces ONLY the bicycle-class detections; every other
        # class keeps coming from the main model.
        self._model_bike = YOLO(bicycle_model) if bicycle_model else None

        # Trackers: bicycles, persons, cars, motorcycles
        self._tracker_bike = sv.ByteTrack()
        self._tracker_ped  = sv.ByteTrack()
        self._tracker_car  = sv.ByteTrack()
        self._tracker_moto = sv.ByteTrack()

        # Per person-track association: tid → {bike, moto, n, f, ...}
        self._assoc: dict[int, dict] = {}
        self._frame_idx = 0

        # Lines created on the first frame (they depend on the width)
        self._line_bike: Optional[CountingLine] = None
        self._line_ped:  Optional[CountingLine] = None
        self._line_car:  Optional[CountingLine] = None
        self._line_moto: Optional[CountingLine] = None
        self._ped_events_seen = 0

        # Final counters: pedestrians and fallback cyclists (fast person with
        # no bicycle detected — complements the bicycle count)
        self._ped_tally = _Tally()
        self._extra_cyc_tally = _Tally()
        # frames of bicycle events not yet "claimed" by a bike-associated
        # person (1:1 pairing in the hybrid crossing)
        self._free_bikes: list[int] = []
        self._bike_events_seen = 0
        self._counted_bike_tids: set[int] = set()
        # person-with-bike events waiting for a bicycle event that may arrive
        # up to 45 frames later (otherwise they count as a cyclist)
        self._pending_ped_bikes: list[dict] = []

        # Motorcycles go through arbitration against bicycle tracks (the
        # bicycle/motorcycle classes compete on two-wheelers)
        self._moto_tally = _Tally()
        self._moto_events_seen = 0
        # bicycle track history: tid → {n, cx, cy, f}
        self._bike_hist: dict[int, dict] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process(self, frame: np.ndarray) -> FrameResult:
        self._ensure_lines(frame.shape[1])
        self._frame_idx += 1

        # 1. Single detection pass for every class
        results = self._model(
            frame,
            conf=self._confidence,
            iou=self._iou,
            imgsz=self._imgsz,
            classes=_ALL_CLASSES,
            agnostic_nms=True,
            verbose=False,
        )[0]
        everything = sv.Detections.from_ultralytics(results)
        everything = self._filter_roi(everything)

        persons_raw = self._by_class(everything, [_PERSON])
        if self._model_bike is not None:
            r_bike = self._model_bike(
                frame, conf=self._confidence, iou=self._iou,
                imgsz=self._imgsz, classes=[_BICYCLE], verbose=False)[0]
            bikes_raw = self._filter_roi(sv.Detections.from_ultralytics(r_bike))
        else:
            bikes_raw = self._by_class(everything, [_BICYCLE])
        cars_raw  = self._by_class(everything, config.CAR_CLASSES)
        motos_raw = self._by_class(everything, config.MOTORCYCLE_CLASSES)

        # 2. Tracking
        bicycles = self._tracker_bike.update_with_detections(bikes_raw)
        persons  = self._tracker_ped.update_with_detections(persons_raw)
        cars     = self._tracker_car.update_with_detections(cars_raw)
        motos    = self._tracker_moto.update_with_detections(motos_raw)

        # 3. Person ↔ bicycle/motorcycle association (per track)
        self._update_assoc(persons, bikes_raw, motos_raw)

        # 3b. Bicycle track history (for motorcycle arbitration and the
        #     "across the screen" count)
        if len(bicycles) and bicycles.tracker_id is not None:
            bcx = (bicycles.xyxy[:, 0] + bicycles.xyxy[:, 2]) / 2
            bcy = (bicycles.xyxy[:, 1] + bicycles.xyxy[:, 3]) / 2
            for k, btid in enumerate(bicycles.tracker_id):
                h = self._bike_hist.setdefault(
                    int(btid), {"n": 0, "cx0": float(bcx[k])})
                h["n"] += 1
                h["cx"] = float(bcx[k])
                h["cy"] = float(bcy[k])
                h["f"] = self._frame_idx

        # 4. Line-crossing counts
        bike_in, bike_out = self._line_bike.trigger(detections=bicycles)
        self._line_ped.trigger(detections=persons)
        car_in, car_out = self._line_car.trigger(detections=cars)
        self._line_moto.trigger(detections=motos)

        # 4b. Motorcycle × bicycle arbitration: a motorcycle event glued to a
        #     recent, consistent bicycle track is a misclassified bicycle —
        #     it does not count as a motorcycle.
        new_moto = 0
        moto_events = self._line_moto.events
        while self._moto_events_seen < len(moto_events):
            ev = dict(moto_events[self._moto_events_seen])
            self._moto_events_seen += 1
            pos = None
            if len(motos) and motos.tracker_id is not None:
                hit = np.where(motos.tracker_id == ev["tid"])[0]
                if len(hit):
                    pos = (float((motos.xyxy[hit[0], 0] + motos.xyxy[hit[0], 2]) / 2),
                           float((motos.xyxy[hit[0], 1] + motos.xyxy[hit[0], 3]) / 2))
            is_bike = False
            if pos is not None:
                for h in self._bike_hist.values():
                    if (h.get("n", 0) >= 3
                            and self._frame_idx - h.get("f", -999) <= 30
                            and abs(pos[0] - h.get("cx", 1e9)) <= 150
                            and abs(pos[1] - h.get("cy", 1e9)) <= 150):
                        is_bike = True
                        break
            if not is_bike:
                self._moto_tally.record(ev["side"], ev)
                new_moto += 1

        # bicycle history cleanup
        if self._frame_idx % 500 == 0:
            limit = self._frame_idx - 600
            for t in [t for t, h in self._bike_hist.items()
                      if h.get("f", 0) < limit]:
                del self._bike_hist[t]

        # 4c. New bicycle events: first they try to settle a pending person
        #     (1:1 pairing); leftovers stay "free" for pairing
        new_extra_cyc = 0
        bike_events = self._line_bike.events
        while self._bike_events_seen < len(bike_events):
            ev_b = bike_events[self._bike_events_seen]
            fb = ev_b.get("frame", self._frame_idx)
            self._counted_bike_tids.add(ev_b.get("tid", -1))
            self._bike_events_seen += 1
            settled = None
            for k, pend in enumerate(self._pending_ped_bikes):
                if abs(pend.get("frame", 0) - fb) <= 45:
                    settled = k
                    break
            if settled is not None:
                self._pending_ped_bikes.pop(settled)
            else:
                self._free_bikes.append(fb)
        # expire very old free bicycles
        self._free_bikes = [f for f in self._free_bikes
                            if self._frame_idx - f <= 90]
        # 4d. "Across the screen" count: bicycle track that died 45 frames ago
        #     WITHOUT crossing the line, but with a large horizontal
        #     displacement — a cyclist who entered/left mid-frame (late
        #     detection, turning). Cristiano counts bicycles that pass across
        #     the SCREEN, not only those crossing the center line.
        for btid, h in list(self._bike_hist.items()):
            # decide 29 frames after death: the line's _counted is not pruned
            # yet (pruning happens after 30) and the same-side re-ID window
            # (30) is practically closed
            if h.get("_decided") or self._frame_idx - h.get("f", 0) != 29:
                continue
            h["_decided"] = True
            if (btid in self._line_bike._counted
                    or btid in self._counted_bike_tids or h["n"] < 4):
                continue
            # skip if there was ANY bicycle event within ≤60 frames — covers
            # the partner tid consumed by reid_opposite/merging, which leaves
            # _counted without an event of its own
            if any(abs(ev_b.get("frame", -999) - h["f"]) <= 60
                   for ev_b in self._line_bike.events[-8:]):
                continue
            shift = h["cx"] - h.get("cx0", h["cx"])
            if abs(shift) < 350:
                continue
            ev_screen = {"frame": h["f"], "tid": int(btid),
                         "side": "left" if shift < 0 else "right",
                         "reason": "screen", "dx": round(shift / max(h["n"], 1), 1)}
            # absorb a pending/future person-with-bike (avoids duplicates)
            settled = None
            for k, pend in enumerate(self._pending_ped_bikes):
                if abs(pend.get("frame", 0) - h["f"]) <= 90:
                    settled = k
                    break
            if settled is not None:
                self._pending_ped_bikes.pop(settled)
            self._free_bikes.append(h["f"])
            self._counted_bike_tids.add(int(btid))
            self._line_bike._counted.add(int(btid))
            self._extra_cyc_tally.record(ev_screen["side"], ev_screen)
            new_extra_cyc += 1

        # pending entries past their deadline with no bicycle → count as a
        # cyclist (through the person)
        expired = [p for p in self._pending_ped_bikes
                   if p["_deadline"] <= self._frame_idx]
        for p in expired:
            self._pending_ped_bikes.remove(p)
            p.pop("_deadline", None)
            self._extra_cyc_tally.record(p["side"], p)
            new_extra_cyc += 1

        # 5. Persons crossing: pedestrian, or fallback cyclist (fast, no
        #    bicycle detected — typical of night motion blur)
        new_ped = 0
        speed_threshold = getattr(config, "CYCLIST_SPEED_THRESHOLD_PX_FRAME", None)
        evs = self._line_ped.events
        while self._ped_events_seen < len(evs):
            ev = dict(evs[self._ped_events_seen])
            self._ped_events_seen += 1
            a = self._assoc.get(ev["tid"], {"bike": 0, "moto": 0, "n": 1})
            n = max(a["n"], 1)
            bike_assoc = a["bike"] / n >= 0.3 or (a["bike"] >= 2 and n <= 10)
            moto_assoc = a["moto"] >= 2 and a["moto"] / n >= 0.5
            if moto_assoc:
                continue   # pillion/rider — already counted through the motorcycle
            if bike_assoc:
                # cyclist: already counted through the bicycle? Pairs with an
                # unclaimed bicycle event within ±45 frames; if there is none,
                # the bicycle flickered in the detection and never formed a
                # crossing track — the cyclist is counted through the person.
                f_ev = ev.get("frame", self._frame_idx)
                pair = None
                for k, fb in enumerate(self._free_bikes):
                    if abs(fb - f_ev) <= 45:
                        pair = k
                        break
                if pair is not None:
                    self._free_bikes.pop(pair)
                else:
                    # wait for a bicycle to cross within the next 45 frames
                    ev["track_class"] = f"cyc_person {a['bike']}b/{n}"
                    ev["_deadline"] = f_ev + 45
                    self._pending_ped_bikes.append(ev)
                continue
            speed = (abs(a.get("cx", 0.0) - a.get("cx0", 0.0))
                     / max(a.get("f", 1) - a.get("f0", 0), 1))
            if speed_threshold is not None and a["n"] >= 4 and speed >= speed_threshold:
                ev["track_class"] = f"cyc_fast speed={speed:.0f}px/f n={a['n']}"
                self._extra_cyc_tally.record(ev["side"], ev)
                new_extra_cyc += 1
            else:
                ev["track_class"] = f"ped {a['bike']}b/{a['moto']}m/{n}"
                self._ped_tally.record(ev["side"], ev)
                new_ped += 1

        # 6. Visual split of persons (pedestrians for annotation)
        _, det_ped = self._visual_split(persons)

        return FrameResult(
            cyclists=bicycles,
            pedestrians=det_ped,
            cars=cars,
            motorcycles=motos,
            total_cyclists=(self._line_bike.in_count + self._line_bike.out_count
                            + self._extra_cyc_tally.in_count
                            + self._extra_cyc_tally.out_count),
            total_pedestrians=self._ped_tally.in_count + self._ped_tally.out_count,
            total_cars=self._line_car.in_count + self._line_car.out_count,
            total_motorcycles=self._moto_tally.in_count + self._moto_tally.out_count,
            cyc_in=self._line_bike.in_count + self._extra_cyc_tally.in_count,
            cyc_out=self._line_bike.out_count + self._extra_cyc_tally.out_count,
            ped_in=self._ped_tally.in_count, ped_out=self._ped_tally.out_count,
            car_in=self._line_car.in_count, car_out=self._line_car.out_count,
            mot_in=self._moto_tally.in_count, mot_out=self._moto_tally.out_count,
            new_cyclists=int(bike_in.sum()) + int(bike_out.sum()) + new_extra_cyc,
            new_pedestrians=new_ped,
            new_cars=int(car_in.sum()) + int(car_out.sum()),
            new_motorcycles=new_moto,
        )

    def reset(self) -> None:
        self._tracker_bike = sv.ByteTrack()
        self._tracker_ped  = sv.ByteTrack()
        self._tracker_car  = sv.ByteTrack()
        self._tracker_moto = sv.ByteTrack()
        self._line_bike = self._line_ped = self._line_car = self._line_moto = None
        self._assoc = {}
        self._ped_events_seen = 0
        self._ped_tally = _Tally()
        self._extra_cyc_tally = _Tally()
        self._moto_tally = _Tally()
        self._free_bikes = []
        self._bike_events_seen = 0
        self._counted_bike_tids = set()
        self._pending_ped_bikes = []
        self._moto_events_seen = 0
        self._bike_hist = {}

    @property
    def lines(self) -> dict:
        """Counters per category (in_count / out_count / events)."""
        return {
            "cyclists":    _CombinedTally(self._line_bike, self._extra_cyc_tally),
            "pedestrians": self._ped_tally,
            "cars":        self._line_car,
            "motorcycles": self._moto_tally,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _ensure_lines(self, width: int) -> None:
        if self._line_ped is not None:
            return
        x = self._line_x_config if self._line_x_config is not None else width // 2
        kw = dict(line_x=x, frame_width=width)
        self._line_bike = CountingLine(**kw)
        self._line_ped  = CountingLine(**kw)
        self._line_car  = CountingLine(**kw)
        self._line_moto = CountingLine(**kw)

    def _filter_roi(self, det: sv.Detections) -> sv.Detections:
        if len(det) == 0:
            return det
        cy = (det.xyxy[:, 1] + det.xyxy[:, 3]) / 2
        return det[(cy >= self._roi_y[0]) & (cy <= self._roi_y[1])]

    def _by_class(self, det: sv.Detections, classes: list[int]) -> sv.Detections:
        if len(det) == 0 or det.class_id is None:
            return sv.Detections.empty()
        mask = np.isin(det.class_id, classes)
        return det[mask] if mask.any() else sv.Detections.empty()

    def _update_assoc(
        self,
        persons: sv.Detections,
        bikes: sv.Detections,
        motos: sv.Detections,
    ) -> None:
        """Accumulates the person↔bike/moto association per person track."""
        if len(persons) == 0 or persons.tracker_id is None:
            self._prune_assoc()
            return

        p_cx = (persons.xyxy[:, 0] + persons.xyxy[:, 2]) / 2
        p_cy = (persons.xyxy[:, 1] + persons.xyxy[:, 3]) / 2

        def _has_nearby(det: sv.Detections, i: int) -> bool:
            # anisotropic: the rider is almost aligned in x with the vehicle,
            # but the person's center sits well above the vehicle's
            if len(det) == 0:
                return False
            cx = (det.xyxy[:, 0] + det.xyxy[:, 2]) / 2
            cy = (det.xyxy[:, 1] + det.xyxy[:, 3]) / 2
            return bool(((np.abs(p_cx[i] - cx) <= 120)
                         & (np.abs(p_cy[i] - cy) <= 250)).any())

        for i, tid in enumerate(persons.tracker_id):
            a = self._assoc.setdefault(
                int(tid), {"bike": 0, "moto": 0, "n": 0, "f": 0,
                           "cx0": float(p_cx[i]), "f0": self._frame_idx})
            a["n"] += 1
            a["f"] = self._frame_idx
            a["cx"] = float(p_cx[i])
            if _has_nearby(bikes, i):
                a["bike"] += 1
            if _has_nearby(motos, i):
                a["moto"] += 1

        self._prune_assoc()

    def _prune_assoc(self) -> None:
        """Drops associations of tracks that died long ago (memory)."""
        if self._frame_idx % 500 != 0:
            return
        limit = self._frame_idx - 600
        dead = [t for t, a in self._assoc.items() if a["f"] < limit]
        for t in dead:
            del self._assoc[t]

    def _visual_split(
        self, persons: sv.Detections
    ) -> tuple[sv.Detections, sv.Detections]:
        """Splits persons into cyclists/pedestrians by the accumulated
        association (visualization only)."""
        if len(persons) == 0 or persons.tracker_id is None:
            return sv.Detections.empty(), sv.Detections.empty()
        is_cyc = np.zeros(len(persons), dtype=bool)
        for i, tid in enumerate(persons.tracker_id):
            a = self._assoc.get(int(tid))
            if a and a["n"] and (a["bike"] / a["n"] >= 0.3
                                 or (a["bike"] >= 2 and a["n"] <= 10)):
                is_cyc[i] = True
        cyc = persons[is_cyc] if is_cyc.any() else sv.Detections.empty()
        ped = persons[~is_cyc] if (~is_cyc).any() else sv.Detections.empty()
        return cyc, ped
