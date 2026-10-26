"""
Settings for the command-line counter (counter/) — Andradas camera.
CAM 4 Intelbras, 1920x1080 @ 15 fps, side view.
"""

# YOLOv8 model (downloaded automatically on the first run)
MODEL = "yolov8n.pt"

# Dedicated BICYCLE model (fine-tuned on this camera with synthetic blur —
# recovers blurred bicycles at dusk). None = main model only. Every other
# class always comes from MODEL.
BICYCLE_MODEL = "runs/ft_blur/weights/best.pt"

# X position of the counting line (vertical, center of a 1920 px frame)
LINE_X = 960
LINE_Y_START = 0      # top of the frame
LINE_Y_END = 1080     # bottom of the frame

# Vertical region of interest: the whole frame
ROI_Y_MIN = 0
ROI_Y_MAX = 1080

# Detection
CONFIDENCE = 0.40
IOU = 0.50

# Max person ↔ bicycle/motorcycle distance for the PER-FRAME association
# (the final classification is per track: see counter/detector.py)
MAX_CYCLIST_DIST_PX = 150

# EXPERIMENTAL (off): minimum speed (px/frame) to reclassify as a cyclist a
# person who crosses with no bicycle detected (night motion blur hides the
# bicycle). Off because ByteTrack id switches pollute the track speed and the
# pedestrian/cyclist lanes overlap on this camera. None = off.
CYCLIST_SPEED_THRESHOLD_PX_FRAME = None

# COCO classes per category
# 0=person, 1=bicycle, 2=car, 3=motorcycle, 5=bus, 7=truck
CYCLIST_CLASSES    = [0, 1]      # person next to a bicycle
PEDESTRIAN_CLASSES = [0]         # person with no bicycle nearby
# car, bus, truck — includes ids 4/5 (bus/truck in the 6-class fine-tuned
# model) and 5/7 (COCO); ids the model in use does not predict are harmless
CAR_CLASSES        = [2, 4, 5, 7]
MOTORCYCLE_CLASSES = [3]         # motorcycle
