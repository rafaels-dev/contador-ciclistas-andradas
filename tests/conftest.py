"""Repository root and worker/ on sys.path, the way the worker really runs
(`python worker/detect.py` imports `reader` and `config` from those places)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for p in (ROOT, ROOT / "worker"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
