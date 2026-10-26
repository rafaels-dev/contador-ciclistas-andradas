#!/usr/bin/env python3
"""Downloads the videos from the Drive folder (Andradas count) via gdown.

Prioritized order: first the videos that have an annotated version
(useful for diagnostics), then the rest.
"""
import subprocess
import sys
from pathlib import Path

DEST = Path(__file__).parent / "videos"
DEST.mkdir(exist_ok=True)

# (name, file_id) — priority order
FILES = [
    ("Andradas_07.mp4", "1t3CuxlwxPeUJe75JiXG5C2PNWbSvvKl1"),
    ("Andradas_19.mp4", "12F1uNpRQsXpKG67848gVTobK6GTFgICR"),
    ("2Andradas_07_anotado.mp4", "1lb7u3apA7GzrBeJsZceavQEkn2STzAkL"),
    ("Andradas_19_anotado.mp4", "1dJ5vikVPRv4h0Y2HAtmWZPTO7Wqplb09"),
    ("Andradas_05.mp4", "1SRn-sqMs8FyNzIM_tTsSKKKnIalcd1sH"),
    ("Andradas_06.mp4", "1BZVx1NZ2j_dRefXdvvylW45qzRtjp5Z0"),
    ("Andradas_08.mp4", "1DH4F0lAOKBqNkhw1bk4L4dmpzTX7vyAm"),
    ("Andradas_09.mp4", "1Rv1RoOHjwKsbBsmnrwx5oLwCukgbTU8a"),
    ("Andradas_10.mp4", "1D5p545E_pYB-Y0-5jMBEpdKJC52jU67H"),
    ("Andradas_11.mp4", "1GOzoPUyfaPEoY7xBOW1E-ieqI4MnBEox"),
    ("Andradas_12.mp4", "1Qdhi0qvvWZMTU_LlU2lGapT7_Ju9tsSQ"),
    ("Andradas_13.mp4", "18FxahaCfscKFTgZ0HlreDXv9SmWrFR_h"),
    ("Andradas_14.mp4", "1gTwV8hztLgjNvRij-xzCwqlOubUxq-48"),
    ("Andradas_15.mp4", "10eefwiwFN8WqR3L8S5zFqbLC7BGa2XkB"),
    ("Andradas_16.mp4", "1fVboFAPSbIeWJZZxBBwJSO1CL7CbOoBu"),
    ("Andradas_17.mp4", "1VAQ-eUSjbsJPSQ0pn6AvJqwtgvcmil9s"),
    ("Andradas_18.mp4", "1N3zP8UCN59329Kc7zVkHi4ch5SGAij2G"),
    ("Andradas_20.mp4", "1ef2dZMkC2X34oKfzXZMQSawmFgr3Zt3j"),
    ("Andradas_21.mp4", "1NB2XZKxHkO28paW6YTv82Bi8Yk9D8YMk"),
    ("Andradas_22.mp4", "1NljGLA4iYCMM1dMicRFqNJbkZoqRQ5Z_"),
    ("Andradas_23.mp4", "1uvj5fJ2pH0ejYGQym3Y7kHInk9BZZy4l"),
]

failures = []
for name, fid in FILES:
    target = DEST / name
    if target.exists() and target.stat().st_size > 100_000_000:
        print(f"[skip] {name} already exists", flush=True)
        continue
    print(f"[downloading] {name} ...", flush=True)
    r = subprocess.run(
        [sys.executable, "-m", "gdown", fid, "-O", str(target), "--quiet"],
    )
    if r.returncode != 0 or not target.exists():
        print(f"[FAILED] {name}", flush=True)
        failures.append(name)
    else:
        print(f"[ok] {name} ({target.stat().st_size / 1e6:.0f} MB)", flush=True)

print(f"Done. {len(failures)} failures: {failures}", flush=True)
