"""
Readers for evaluation outputs written before the English translation.

The scripts in this folder now write English keys and file names, but the
historical outputs (sweeps such as `varredura_v9/`, the `mineracao/` mining
folder, the mined candidates sent to Cristiano) are Portuguese. These helpers
accept both formats and always return the English one.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
# This folder was avaliacao/ before 0.0.8. Git moves the scripts, but the
# untracked videos and outputs of another clone stay behind in avaliacao/.
OLD_DIR = HERE.parent / "avaliacao"

# Portuguese → English category names (old outputs and the old LLM labels)
CATEGORY = {
    "ciclistas": "cyclists", "pedestres": "pedestrians", "automoveis": "cars",
    "motocicletas": "motorcycles", "patinetes": "kick_scooters", "scooters": "mopeds",
    "monociclos": "unicycles", "outros": "other", "descartado": "discarded",
}
# old CountingLine reasons and sides
REASON = {"centroide": "centroid", "centroide_gap": "centroid_gap",
          "reid_oposto": "reid_opposite", "entrada": "entry", "tela": "screen"}
SIDE = {"esq": "left", "dir": "right"}

_EVENT_KEYS = {"categoria": "category", "frame_video": "video_frame", "tempo_s": "time_s",
               "motivo": "reason", "lado": "side", "classe_track": "track_class"}
_CANDIDATE_KEYS = {"hora": "hour", "tempo_s": "time_s", "fonte": "source",
                   "caixa": "box", "y_centro": "y_center"}


def first_existing(*paths: Path) -> Path:
    """First path that exists; the first one when none does."""
    for p in paths:
        if p.exists():
            return p
    return paths[0]


def local(name: str, old_name: str | None = None) -> Path:
    """evaluation/<name>; if it is not there, the same thing left in the old
    avaliacao/ folder or under its old name (old_name). The new path when
    nothing exists (for writing)."""
    names = [name] + ([old_name] if old_name else [])
    return first_existing(*[d / n for d in (HERE, OLD_DIR) for n in names])


def _rename(rec: dict, keys: dict) -> dict:
    return {keys.get(k, k): v for k, v in rec.items()}


def event(ev: dict) -> dict:
    """A run_instrumented.py event in the English format."""
    ev = _rename(ev, _EVENT_KEYS)
    if "category" in ev:
        ev["category"] = CATEGORY.get(ev["category"], ev["category"])
    if "reason" in ev:
        ev["reason"] = REASON.get(ev["reason"], ev["reason"])
    if "side" in ev:
        ev["side"] = SIDE.get(ev["side"], ev["side"])
    return ev


def load_events(diag_dir: Path) -> list[dict]:
    """Events of a diagnostic folder (events.jsonl, or the old eventos.jsonl)."""
    p = first_existing(diag_dir / "events.jsonl", diag_dir / "eventos.jsonl")
    with open(p, encoding="utf-8") as f:
        return [event(json.loads(line)) for line in f if line.strip()]


def track(t: dict) -> dict:
    """A tracks.json entry in the English format."""
    t = dict(t)
    if "cat" in t:
        t["cat"] = CATEGORY.get(t["cat"], t["cat"])
    return t


def summary(d: dict) -> dict:
    """A summary.json (old resumo.json) in the English format."""
    keys = {"fps_processamento": "processing_fps", "totais": "totals",
            "direcoes": "directions", "por_motivo": "by_reason"}
    d = _rename(d, keys)
    for k in ("totals", "directions", "by_reason"):
        if isinstance(d.get(k), dict):
            d[k] = {CATEGORY.get(c, c): v for c, v in d[k].items()}
    if isinstance(d.get("by_reason"), dict):
        d["by_reason"] = {c: {REASON.get(r, r): n for r, n in v.items()}
                          for c, v in d["by_reason"].items()}
    return d


def load_summary(diag_dir: Path) -> dict:
    p = first_existing(diag_dir / "summary.json", diag_dir / "resumo.json")
    return summary(json.loads(p.read_text(encoding="utf-8")))


def candidate(c: dict) -> dict:
    """A mined candidate (mine_candidates.py) in the English format."""
    return _rename(c, _CANDIDATE_KEYS)


def load_candidates(path: Path) -> list[dict]:
    return [candidate(c) for c in json.loads(Path(path).read_text(encoding="utf-8"))]


def mining_dir(root: Path = HERE) -> Path:
    """The mining folder (mining/, or the old mineracao/ — also in avaliacao/)."""
    return first_existing(root / "mining", root / "mineracao",
                          OLD_DIR / "mining", OLD_DIR / "mineracao")


def load_mined_candidates(mining: Path) -> list[dict]:
    """candidates.json of the mining folder (or the old candidatos.json)."""
    return load_candidates(first_existing(mining / "candidates.json",
                                          mining / "candidatos.json"))


def blob(b: dict) -> dict:
    """A count_scanline.py blob in the English format."""
    return _rename(b, {"y_centro": "y_center", "altura_px": "height_px"})


def load_blobs(path: Path) -> list[dict]:
    return [blob(b) for b in json.loads(Path(path).read_text(encoding="utf-8"))]
