#!/usr/bin/env python3
"""
Fine-tuning do yolov8n no dataset desta câmera (com blur sintético).
Saída: runs/ft_blur/weights/best.pt
"""
from pathlib import Path

from ultralytics import YOLO

RAIZ = Path(__file__).resolve().parent

m = YOLO("yolov8n.pt")
m.train(
    data=str(RAIZ / "dataset/data.yaml"),
    epochs=30,
    imgsz=640,
    batch=16,
    workers=4,
    patience=10,
    project=str(RAIZ.parent / "runs"),
    name="ft_blur",
    exist_ok=True,
    verbose=False,
)
print("treino concluído:", RAIZ.parent / "runs/ft_blur/weights/best.pt")
