"""Worker end to end: a synthetic video with a block crossing the line goes
through the real worker/detect.py (FFmpeg reading, YOLO, background
subtraction, candidates, filmstrip, context and clip) and then through
worker/render.py. YOLO does not recognize the block — the motion detector
catches it, like the blurred cyclists."""
import csv
import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT, FPS, SECONDS = 640, 360, 15, 8
ENV = {**os.environ, "TRAFFIC_COUNTER_NO_NVDEC": "1", "PYTHONUTF8": "1"}


def write_video(target: Path, to_the_right: bool) -> None:
    rng = np.random.default_rng(0)
    background = cv2.GaussianBlur(rng.integers(90, 160, (HEIGHT, WIDTH, 3), dtype=np.uint8), (0, 0), 3)
    writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (WIDTH, HEIGHT))
    start, end = int(3.5 * FPS), int(7.0 * FPS)  # the MOG2 background warms up for 3 s
    for i in range(SECONDS * FPS):
        q = background.copy()
        if start <= i <= end:
            f = (i - start) / (end - start)
            x = int(40 + f * (WIDTH - 120)) if to_the_right else int(WIDTH - 80 - f * (WIDTH - 120))
            cv2.rectangle(q, (x, 170), (x + 40, 250), (20, 20, 20), -1)
        writer.write(q)
    writer.release()


def run_worker(script: str, *args) -> list[dict]:
    r = subprocess.run([sys.executable, str(ROOT / "worker" / script), *map(str, args)],
                       capture_output=True, text=True, encoding="utf-8", env=ENV, timeout=600)
    events = [json.loads(l) for l in r.stdout.splitlines() if l.startswith("{")]
    assert r.returncode == 0, r.stderr[-3000:]
    assert events[-1]["type"] == "done", events[-3:]
    return events


LINES = [{"id": "l1", "name": "Line 1", "x1": 0.5, "y1": 0.4, "x2": 0.5, "y2": 0.9}]


def detect(tmp_path: Path, to_the_right: bool) -> tuple[Path, list[dict]]:
    tmp_path.mkdir()
    video = tmp_path / "synthetic.mp4"
    write_video(video, to_the_right)
    lines = tmp_path / "lines.json"
    lines.write_text(json.dumps(LINES))
    output = tmp_path / "candidates"
    run_worker("detect.py", "--video", video, "--output", output, "--lines", lines)
    assert not (tmp_path / "preview.jpg").exists(), "the preview must be deleted at the end"
    cands = json.loads((output / "candidates.json").read_text(encoding="utf-8"))
    for c in cands:
        for field in ("filmstrip", "context", "clip"):
            assert (output / c[field]).stat().st_size > 0, c[field]
    return video, cands


@pytest.mark.slow
def test_a_block_crossing_the_line_becomes_one_candidate(tmp_path):
    video, there = detect(tmp_path / "there", to_the_right=True)
    _, back = detect(tmp_path / "back", to_the_right=False)
    assert len(there) == 1 and len(back) == 1, (there, back)
    assert there[0]["line_id"] == "l1"
    assert {there[0]["direction"], back[0]["direction"]} == {"A→B", "B→A"}
    # crosses x = 320 in the middle of the motion (≈ 5.25 s)
    assert 4.5 <= there[0]["time_s"] <= 6.0
    # box in px of the original video, around the block
    x1, y1, x2, y2 = there[0]["bbox"]
    assert 250 <= (x1 + x2) / 2 <= 390 and 230 <= y2 <= 270

    # final video in the app language: the labels come in the plan
    c = there[0]
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({
        "categories": None,
        "labels": {"title": "Contagem", "no_line": "Sem linha", "video_n": "Vídeo {n}/{total}",
                   "plural": {"cyclists": "Ciclistas"}, "singular": {"cyclists": "Ciclista"},
                   "csv": ["vídeo", "tempo", "tempo_final", "linha", "categoria", "sentido", "candidato"]},
        "videos": [{"title": "synthetic", "video": str(video), "tracks": str(tmp_path / "there" / "tracks.json.gz"),
                    "lines": LINES, "events": [{"id": 7, "frame": c["frame"], "line_id": "l1",
                                                "category": "cyclists", "direction": c["direction"],
                                                "track": c["track"]}]}],
    }, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "render"
    events = run_worker("render.py", "--plan", plan, "--output", out)
    assert events[-1]["events"] == 1
    assert (out / "final_video.mp4").stat().st_size > 0
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert report["totals"] == {"Line 1": {"cyclists": 1}}
    with open(out / "events.csv", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f, delimiter=";"))
    assert rows[0][0] == "vídeo"
    assert rows[1][3:5] == ["Line 1", "Ciclista"]
