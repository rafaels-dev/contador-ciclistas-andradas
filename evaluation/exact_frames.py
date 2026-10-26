"""
Extraction of EXACT frames by index, with sequential decoding.

cap.set(CAP_PROP_POS_FRAMES) misses by ~30 s (~450 frames) on this DVR's
files: the seek is done by time using the average fps, but the container
index is inconsistent, and the error is silent (get() reports the requested
position).

The only reliable way to match the runners' numbering (they read
sequentially) is to decode sequentially from frame 0. cv2.grab() skips
frames without converting them — ~1 min per hour of video.

Usage:
    from exact_frames import exact_frames
    for idx, frame in exact_frames("video.mp4", [100, 250, 900]):
        ...
"""
from __future__ import annotations

import cv2


def exact_frames(video: str, indices: list[int]):
    """Yields (index, frame) in increasing order of the requested indices.
    100% sequential decoding from frame 0."""
    targets = sorted(set(int(i) for i in indices))
    if not targets:
        return
    cap = cv2.VideoCapture(video)
    try:
        current = 0
        for target in targets:
            while current < target:
                if not cap.grab():
                    return
                current += 1
            ok, frame = cap.read()
            if not ok:
                return
            current += 1
            yield target, frame
    finally:
        cap.release()
