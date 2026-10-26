#!/usr/bin/env python3
"""
Final sweep: processes every hourly video with the current counter and
consolidates a per-hour table (4 categories × in/out) in JSON and text.

Usage: python evaluation/sweep_all.py [--dir evaluation/videos] [--output evaluation/sweep]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy

CATS = ["cyclists", "pedestrians", "cars", "motorcycles"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="evaluation/videos")
    p.add_argument("--output", default="evaluation/sweep")
    args = p.parse_args()

    root = Path(__file__).resolve().parent.parent
    videos = sorted(Path(args.dir).glob("Andradas_*.mp4"))
    videos = [v for v in videos if re.fullmatch(r"Andradas_\d\d\.mp4", v.name)]
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    table = {}
    for v in videos:
        hour = v.stem.split("_")[1]
        diag = output / f"diag_{hour}"
        # an earlier run may have left the old resumo.json
        if not (diag / "summary.json").exists() and not (diag / "resumo.json").exists():
            print(f"[{hour}] processing {v.name} ...", flush=True)
            r = subprocess.run(
                [sys.executable, str(root / "evaluation/run_instrumented.py"),
                 "--video", str(v), "--output", str(diag),
                 "--max-snapshots", "150"],
                capture_output=True, text=True)
            if r.returncode != 0:
                print(f"[{hour}] FAILED: {r.stderr[-500:]}", flush=True)
                continue
        d = legacy.load_summary(diag)
        table[hour] = {"totals": d["totals"], "directions": d["directions"],
                       "by_reason": d["by_reason"]}
        print(f"[{hour}] {d['totals']}", flush=True)

    (output / "table.json").write_text(json.dumps(table, indent=1, ensure_ascii=False),
                                       encoding="utf-8")

    # text table
    rows = [f"{'hour':>4} {'cyc':>5} {'ped':>5} {'car':>5} {'mot':>5}"]
    tot = {c: 0 for c in CATS}
    for hour in sorted(table):
        t = table[hour]["totals"]
        for k in tot:
            tot[k] += t[k]
        rows.append(f"{hour:>4} {t['cyclists']:>5} {t['pedestrians']:>5} "
                    f"{t['cars']:>5} {t['motorcycles']:>5}")
    rows.append(f"{'TOT':>4} {tot['cyclists']:>5} {tot['pedestrians']:>5} "
                f"{tot['cars']:>5} {tot['motorcycles']:>5}")
    text = "\n".join(rows)
    (output / "table.txt").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
