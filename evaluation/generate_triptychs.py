#!/usr/bin/env python3
"""
For each mined candidate, generates a TRIPTYCH for LLM classification:
3 frames (t-1s, t, t+1s) at 480x270 side by side + a 2x zoom of the
candidate region on the center frame. Grids of 4 triptychs per image.

Output: evaluation/mining/triptychs/grid_XXX.png
        evaluation/mining/triptychs/map.json  (grid/position → id)
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy

ROOT = Path(__file__).resolve().parent
MINING = legacy.mining_dir(ROOT)
FPS = 14.874455802535433
DELTA = 15   # ~1 s


def compose_triptych(frames3, c):
    panels = [cv2.resize(f, (480, 270)) for f in frames3]
    top = np.hstack(panels)
    # 2x zoom on the candidate region (center frame, full resolution)
    fr = frames3[1]
    if c.get("box"):
        cx = int((c["box"][0] + c["box"][2]) / 2)
        cy = int((c["box"][1] + c["box"][3]) / 2)
    else:
        cx, cy = 960, int(c.get("y", 700))
    x1, y1 = max(0, cx - 240), max(0, cy - 135)
    x2, y2 = min(fr.shape[1], x1 + 480), min(fr.shape[0], y1 + 270)
    zoom = cv2.resize(fr[y1:y2, x1:x2], (960, 540))
    label = np.full((540, 480, 3), 25, np.uint8)
    cv2.putText(label, c["id"], (20, 90), cv2.FONT_HERSHEY_SIMPLEX,
                1.6, (0, 255, 255), 3)
    cv2.putText(label, f"hour {c['hour']}", (20, 160),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (200, 200, 200), 2)
    cv2.putText(label, f"t={c['time_s']}s", (20, 220),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (200, 200, 200), 2)
    bottom = np.hstack([label, zoom])
    trip = np.vstack([top, bottom])
    cv2.rectangle(trip, (0, 0), (trip.shape[1] - 1, trip.shape[0] - 1),
                  (90, 90, 90), 2)
    return trip   # 1440 x 810


def main():
    cands = legacy.load_mined_candidates(MINING)
    out = MINING / "triptychs"
    out.mkdir(parents=True, exist_ok=True)

    by_hour = {}
    for c in cands:
        by_hour.setdefault(c["hour"], []).append(c)

    trips = {}
    for hour, items in sorted(by_hour.items()):
        video = str(ROOT / f"videos/Andradas_{hour}.mp4")
        requests = {}
        for c in items:
            for f in (c["frame"] - DELTA, c["frame"], c["frame"] + DELTA):
                requests.setdefault(max(0, f), []).append(c["id"])
        got = {}
        cap = cv2.VideoCapture(video)
        targets = sorted(requests)
        ti = 0
        i = 0
        while ti < len(targets):
            ok, fr = cap.read()
            if not ok:
                break
            if i == targets[ti]:
                got[i] = fr.copy()
                ti += 1
            i += 1
        cap.release()
        for c in items:
            f3 = [got.get(max(0, c["frame"] + d))
                  for d in (-DELTA, 0, DELTA)]
            if any(x is None for x in f3):
                continue
            trips[c["id"]] = compose_triptych(f3, c)
        print(f"[{hour}] {len(items)} triptychs", flush=True)

    # grids of 4 (2x2), half scale → 1440x810
    ids = sorted(trips)
    grid_map = {}
    for g in range(0, len(ids), 4):
        block = ids[g:g + 4]
        cells = [cv2.resize(trips[i], (720, 405)) for i in block]
        while len(cells) < 4:
            cells.append(np.zeros((405, 720, 3), np.uint8))
        grid = np.vstack([np.hstack(cells[:2]), np.hstack(cells[2:])])
        name = f"grid_{g//4:03d}.png"
        cv2.imwrite(str(out / name), grid)
        grid_map[name] = block
    (out / "map.json").write_text(json.dumps(grid_map, indent=1))
    print(f"{len(ids)} triptychs in {len(grid_map)} grids", flush=True)


if __name__ == "__main__":
    main()
