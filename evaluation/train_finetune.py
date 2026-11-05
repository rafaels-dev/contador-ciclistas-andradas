#!/usr/bin/env python3
"""
Fine-tunes yolov8n on this camera's dataset (with synthetic blur).
Output: runs/ft_blur/weights/best.pt
"""
import sys
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import legacy  # noqa: E402

m = YOLO("yolov8n.pt")
m.train(
    data=str(legacy.local("dataset") / "data.yaml"),
    epochs=30,
    imgsz=640,
    batch=16,
    workers=4,
    patience=10,
    project=str(ROOT.parent / "runs"),
    name="ft_blur",
    exist_ok=True,
    verbose=False,
)
print("training done:", ROOT.parent / "runs/ft_blur/weights/best.pt")
