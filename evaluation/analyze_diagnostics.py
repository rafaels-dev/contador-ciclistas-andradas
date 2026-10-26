#!/usr/bin/env python3
"""
Analyzes the output of run_instrumented.py and flags suspects:

  1. counted_without_crossing — counted track whose cx never passed the line
  2. inverted_direction       — counted on "entry" with the direction opposite to the real motion
  3. crossed_without_count    — track that crossed the line but was never counted
  4. possible_duplicate       — two events of the same category close in time/space

Usage: python evaluation/analyze_diagnostics.py evaluation/diag_07 [--line-x 960]
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy


def main():
    p = argparse.ArgumentParser()
    p.add_argument("dir")
    p.add_argument("--line-x", type=float, default=960)
    p.add_argument("--min-frames", type=int, default=3,
                   help="ignore tracks shorter than this in crossed_without_count")
    args = p.parse_args()
    d = Path(args.dir)
    LX = args.line_x

    tracks = [legacy.track(t) for t in json.loads((d / "tracks.json").read_text())]
    events = legacy.load_events(d)

    tr_by_key = {(t["cat"], t["tid"]): t for t in tracks}
    ev_by_key = defaultdict(list)
    for ev in events:
        ev_by_key[(ev["category"], ev["tid"])].append(ev)

    rep = {"counted_without_crossing": [], "inverted_direction": [],
           "crossed_without_count": [], "possible_duplicate": []}

    # 1 and 2 — over counted events
    for ev in events:
        t = tr_by_key.get((ev["category"], ev["tid"]))
        if t is None:
            continue
        crossed = t["cxmin"] < LX <= t["cxmax"]
        if not crossed:
            rep["counted_without_crossing"].append({**ev, "cx_range": [t["cxmin"], t["cxmax"]],
                                                    "frames": [t["f0"], t["f1"]]})
        if ev["reason"] == "entry" and t["n"] >= 3:
            dx = t["cx1"] - t["cx0"]
            # side "left" = in = right→left = negative dx expected
            if abs(dx) > 30:
                expected = "left" if dx < 0 else "right"
                if ev["side"] != expected:
                    rep["inverted_direction"].append({**ev, "dx": round(dx, 1)})

    # 3 — tracks that crossed and were never counted
    counted = set(ev_by_key.keys())
    for t in tracks:
        if (t["cat"], t["tid"]) in counted:
            continue
        if t["n"] < args.min_frames:
            continue
        if t["cxmin"] < LX <= t["cxmax"] and abs(t["cx1"] - t["cx0"]) > 60:
            rep["crossed_without_count"].append(t)

    # 4 — events close in time (≤ 5 s) and space in the same category/direction
    by_cat = defaultdict(list)
    for ev in events:
        by_cat[ev["category"]].append(ev)
    for cat, evs in by_cat.items():
        evs.sort(key=lambda e: e["video_frame"])
        for i in range(len(evs) - 1):
            a, b = evs[i], evs[i + 1]
            if b["video_frame"] - a["video_frame"] <= 75 and a["side"] == b["side"]:
                rep["possible_duplicate"].append(
                    {"cat": cat, "side": a["side"],
                     "frames": [a["video_frame"], b["video_frame"]],
                     "tids": [a["tid"], b["tid"]],
                     "reasons": [a["reason"], b["reason"]]})

    summary = {k: len(v) for k, v in rep.items()}
    summary["total_events"] = len(events)
    summary["total_tracks"] = len(tracks)
    print(json.dumps(summary, indent=2))
    (d / "analysis.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False),
                                     encoding="utf-8")
    print(f"details in {d/'analysis.json'}")


if __name__ == "__main__":
    main()
