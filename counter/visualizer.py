"""
Visual frame annotation — 4 categories in distinct colors.

  Cyclists    → green
  Pedestrians → yellow
  Cars        → orange
  Motorcycles → cyan
"""

from __future__ import annotations

import cv2
import numpy as np
import supervision as sv

from .detector import FrameResult


def _make_annotators(color: sv.Color):
    return (
        sv.BoxAnnotator(color=color, thickness=2),
        sv.LabelAnnotator(color=color, text_color=sv.Color.WHITE,
                          text_scale=0.55, text_thickness=1),
        sv.TraceAnnotator(color=color, thickness=2, trace_length=25),
    )

_COLOR_CYC = sv.Color(r=30,  g=210, b=30)    # green
_COLOR_PED = sv.Color(r=220, g=210, b=0)     # yellow
_COLOR_CAR = sv.Color(r=255, g=120, b=0)     # orange
_COLOR_MOT = sv.Color(r=0,   g=190, b=230)   # cyan

_box_cyc, _lbl_cyc, _trc_cyc = _make_annotators(_COLOR_CYC)
_box_ped, _lbl_ped, _trc_ped = _make_annotators(_COLOR_PED)
_box_car, _lbl_car, _trc_car = _make_annotators(_COLOR_CAR)
_box_mot, _lbl_mot, _trc_mot = _make_annotators(_COLOR_MOT)


def annotate_frame(
    frame: np.ndarray,
    result: FrameResult,
    line_x: int,
    show_traces: bool = True,
) -> np.ndarray:
    """Returns an annotated copy with bboxes, traces, counting line and panel."""
    out = frame.copy()

    # Red flash when something crosses the line
    any_new = (result.new_cyclists + result.new_pedestrians
               + result.new_cars + result.new_motorcycles)
    if any_new > 0:
        overlay = out.copy()
        cv2.rectangle(overlay, (0, 0), (out.shape[1], out.shape[0]), (0, 0, 200), -1)
        cv2.addWeighted(overlay, 0.12, out, 0.88, 0, out)

    # Trajectory traces
    if show_traces:
        out = _trc_cyc.annotate(scene=out, detections=result.cyclists)
        out = _trc_ped.annotate(scene=out, detections=result.pedestrians)
        out = _trc_car.annotate(scene=out, detections=result.cars)
        out = _trc_mot.annotate(scene=out, detections=result.motorcycles)

    # Bounding boxes
    out = _box_cyc.annotate(scene=out, detections=result.cyclists)
    out = _box_ped.annotate(scene=out, detections=result.pedestrians)
    out = _box_car.annotate(scene=out, detections=result.cars)
    out = _box_mot.annotate(scene=out, detections=result.motorcycles)

    # Labels with category prefix and tracker ID
    out = _lbl_cyc.annotate(scene=out, detections=result.cyclists,
                            labels=_ids(result.cyclists, "C"))
    out = _lbl_ped.annotate(scene=out, detections=result.pedestrians,
                            labels=_ids(result.pedestrians, "P"))
    out = _lbl_car.annotate(scene=out, detections=result.cars,
                            labels=_ids(result.cars, "A"))
    out = _lbl_mot.annotate(scene=out, detections=result.motorcycles,
                            labels=_ids(result.motorcycles, "M"))

    # Vertical counting line
    h = out.shape[0]
    cv2.line(out, (line_x, 0), (line_x, h), (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(out, "counting line", (line_x + 6, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

    _panel(out, result)
    return out


def _ids(det: sv.Detections, prefix: str) -> list[str]:
    ids = det.tracker_id
    if ids is None or len(ids) == 0:
        return []
    return [f"{prefix}#{tid}" for tid in ids]


def _panel(frame: np.ndarray, r: FrameResult) -> None:
    """Semi-transparent panel in the top-left corner with the 4 counters."""
    pw, ph = 340, 210
    overlay = frame.copy()
    cv2.rectangle(overlay, (8, 8), (8 + pw, 8 + ph), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.68, frame, 0.32, 0, frame)

    font  = cv2.FONT_HERSHEY_DUPLEX
    white = (240, 240, 240)

    cv2.putText(frame, "TRAFFIC COUNT", (16, 32), font, 0.42, white, 1)
    cv2.line(frame, (16, 40), (8 + pw - 8, 40), (70, 70, 70), 1)

    # Color legend
    _panel_row(frame, y=70,  color=(30, 210, 30),  label="Cyclists",
               total=r.total_cyclists,    n_in=r.cyc_in, n_out=r.cyc_out)
    _panel_row(frame, y=105, color=(0, 210, 220),  label="Pedestrians",
               total=r.total_pedestrians, n_in=r.ped_in, n_out=r.ped_out)
    _panel_row(frame, y=140, color=(0, 120, 255),  label="Cars",
               total=r.total_cars,        n_in=r.car_in, n_out=r.car_out)
    _panel_row(frame, y=175, color=(230, 120, 0),  label="Motorcycles",
               total=r.total_motorcycles, n_in=r.mot_in, n_out=r.mot_out)

    cv2.line(frame, (16, 188), (8 + pw - 8, 188), (70, 70, 70), 1)
    cv2.putText(frame, f"Grand total: {r.grand_total}", (16, 205),
                font, 0.50, white, 1)


def _panel_row(frame, y, color, label, total, n_in, n_out):
    font = cv2.FONT_HERSHEY_DUPLEX
    # Colored square as the legend
    cv2.rectangle(frame, (16, y - 12), (28, y), color, -1)
    cv2.putText(frame, label,      (35, y),  font, 0.50, color,           1)
    cv2.putText(frame, str(total), (210, y), font, 0.85, color,           2)
    cv2.putText(frame, f"in {n_in}  out {n_out}",
                                   (255, y), font, 0.37, (170, 170, 170), 1)
