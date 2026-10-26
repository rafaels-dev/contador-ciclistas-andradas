#!/usr/bin/env python3
"""
Consolidates "uncounted bicycle" candidates from 3 sources:

  A. orphan blobs — motion on the line column (independent counter) with
     NO counted event (any category) within ±15 frames;
  B. fast night pedestrians — pedestrian events 17h-23h with
     |dx| ≥ 35 px/frame (night cyclists fall into this bucket);
  C. low-confidence bicycle detections (0.05-0.40) from the FT model in
     hours 17-23, grouped in windows, with no cyclist event within ±45.

Dedupe across sources with a 4 s window. Priority C > B > A; cap per hour.

Output: evaluation/mining/candidates.json
        [{id, hour, frame, time_s, source, box (or null), y}]
"""
import bisect
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy

ROOT = Path(__file__).resolve().parent
# English folder names, falling back to the historical Portuguese ones
MINING = legacy.mining_dir(ROOT)
SWEEP = legacy.first_existing(ROOT / "sweep_dual", ROOT / "varredura_dual")
FPS = 14.874455802535433
HOURS = [f"{h:02d}" for h in range(5, 24)]
NIGHT = {"17", "18", "19", "20", "21", "22", "23"}
CAP_PER_HOUR = 45


def main():
    # lowconf_bike.json: {hour: [{"f": frame, "conf": c, "box": [x1, y1, x2, y2]}]}
    lowconf = json.loads((MINING / "lowconf_bike.json").read_text())
    candidates = []

    for hour in HOURS:
        evs = legacy.load_events(SWEEP / f"diag_{hour}")
        counted_frames = sorted(e["video_frame"] for e in evs)
        cyc_frames = sorted(e["video_frame"] for e in evs
                            if e["category"] == "cyclists")

        def near(f, frames, tol):
            i = bisect.bisect_left(frames, f - tol)
            return i < len(frames) and frames[i] <= f + tol

        hour_cands = []

        # C: low-conf bikes grouped in 4 s windows
        if hour in lowconf:
            hits = sorted(lowconf[hour], key=lambda x: x["f"])
            window = []
            for hcand in hits + [{"f": 10**9}]:
                if window and hcand["f"] - window[-1]["f"] > int(4 * FPS):
                    best = max(window, key=lambda x: x["conf"])
                    if not near(best["f"], cyc_frames, int(3 * FPS)):
                        hour_cands.append({"frame": best["f"], "source": "C",
                                           "box": best["box"],
                                           "conf": best["conf"]})
                    window = []
                if hcand["f"] < 10**9:
                    window.append(hcand)

        # B: fast night pedestrians
        if hour in NIGHT:
            for e in evs:
                if (e["category"] == "pedestrians"
                        and abs(e.get("dx", 0)) >= 35):
                    hour_cands.append({"frame": e["video_frame"], "source": "B",
                                       "box": e.get("bbox"), "conf": None})

        # A: orphan blobs
        pb = MINING / f"blobs/blobs_{hour}.json"
        if pb.exists():
            for b in legacy.load_blobs(pb):
                f = b["frame"] + b["dur_frames"] // 2
                if not near(f, counted_frames, 15):
                    hour_cands.append({"frame": f, "source": "A", "box": None,
                                       "conf": None, "y": b["y_center"]})

        # dedupe with a 4 s window, priority C > B > A; smaller cap for source A
        # during the day (our daytime count is already ~90-100% — daytime
        # orphan blobs are mostly shadows)
        prio = {"C": 0, "B": 1, "A": 2}
        cap_a = 25 if hour in NIGHT else 8
        hour_cands.sort(key=lambda c: (prio[c["source"]], c["frame"]))
        accepted, n_a = [], 0
        for c in hour_cands:
            if c["source"] == "A" and n_a >= cap_a:
                continue
            if all(abs(c["frame"] - a["frame"]) > int(4 * FPS) for a in accepted):
                accepted.append(c)
                if c["source"] == "A":
                    n_a += 1
        accepted = accepted[:CAP_PER_HOUR]
        for c in accepted:
            c["hour"] = hour
            c["time_s"] = round(c["frame"] / FPS, 1)
        candidates.extend(accepted)

    candidates.sort(key=lambda c: (c["hour"], c["frame"]))
    for i, c in enumerate(candidates):
        c["id"] = f"c{i:04d}"
    (MINING / "candidates.json").write_text(
        json.dumps(candidates, indent=1))
    print(f"{len(candidates)} candidates",
          dict(Counter(c['source'] for c in candidates)),
          dict(Counter(c['hour'] for c in candidates)))


if __name__ == "__main__":
    main()
