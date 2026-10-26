"""Raiz do repositório e worker/ no sys.path, como o worker roda de verdade
(`python worker/detectar.py` importa `leitor` e `config` desses lugares)."""
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
for p in (RAIZ, RAIZ / "worker"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
