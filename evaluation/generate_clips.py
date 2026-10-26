#!/usr/bin/env python3
"""
For each mined candidate, generates a 3 s MP4 clip (480x270, looped in the
app) and a JPG keyframe (960px, with the candidate box drawn when there is
one). 100% sequential decoding per video (immune to the seek bug).

Output: evaluation/mining/webapp/clips/<id>.mp4 and <id>.jpg
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy

ROOT = Path(__file__).resolve().parent
MINING = legacy.mining_dir(ROOT)
FPS = 14.874455802535433
HALF_WINDOW = 22   # ~1.5 s on each side


def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    cands = legacy.load_mined_candidates(MINING)
    out = MINING / "webapp/clips"
    out.mkdir(parents=True, exist_ok=True)
    ff = ffmpeg_exe()

    by_hour = {}
    for c in cands:
        by_hour.setdefault(c["hour"], []).append(c)

    for hour, items in sorted(by_hour.items()):
        video = ROOT / f"videos/Andradas_{hour}.mp4"
        items.sort(key=lambda c: c["frame"])
        windows = [(max(0, c["frame"] - HALF_WINDOW),
                    c["frame"] + HALF_WINDOW, c) for c in items]
        cap = cv2.VideoCapture(str(video))
        open_clips = []   # (end, proc, cand)
        next_idx = 0
        i = 0
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            while next_idx < len(windows) and windows[next_idx][0] == i:
                start, end, c = windows[next_idx]
                next_idx += 1
                proc = subprocess.Popen(
                    [ff, "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
                     "-s", "480x270", "-pix_fmt", "bgr24", "-r", "15",
                     "-i", "pipe:", "-vcodec", "libx264", "-preset", "fast",
                     "-crf", "27", "-pix_fmt", "yuv420p",
                     str(out / f"{c['id']}.mp4")],
                    stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
                open_clips.append([end, proc, c])
            # send the frame to the open clips
            if open_clips:
                small = cv2.resize(fr, (480, 270))
                cv2.line(small, (240, 0), (240, 270), (0, 0, 255), 1)
            for slot in open_clips:
                slot[1].stdin.write(small.tobytes())
            # keyframe on the center frame
            for _, _, c in open_clips:
                if c["frame"] == i:
                    kf = fr.copy()
                    cv2.line(kf, (960, 0), (960, 1080), (0, 0, 255), 2)
                    if c.get("box"):
                        x1, y1, x2, y2 = [int(v) for v in c["box"]]
                        cv2.rectangle(kf, (x1, y1), (x2, y2), (0, 255, 0), 3)
                    elif c.get("y"):
                        cv2.circle(kf, (960, int(c["y"])), 70, (0, 255, 0), 3)
                    kf = cv2.resize(kf, (960, 540))
                    cv2.imwrite(str(out / f"{c['id']}.jpg"), kf,
                                [cv2.IMWRITE_JPEG_QUALITY, 82])
            # close expired clips
            remaining = []
            for slot in open_clips:
                if i >= slot[0]:
                    slot[1].stdin.close()
                    slot[1].wait()
                else:
                    remaining.append(slot)
            open_clips = remaining
            if next_idx >= len(windows) and not open_clips:
                break
            i += 1
        for slot in open_clips:
            slot[1].stdin.close()
            slot[1].wait()
        cap.release()
        print(f"[{hour}] {len(items)} clips", flush=True)
    print("clips ready", flush=True)


if __name__ == "__main__":
    main()
