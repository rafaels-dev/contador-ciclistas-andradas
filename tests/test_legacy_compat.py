"""Names and paths from before 0.0.8 (Portuguese) keep working: the worker's
environment variables, the old avaliacao/ folder and the evaluation outputs
written with Portuguese keys and file names."""
import json
import sys

import pytest

from conftest import ROOT

sys.path.insert(0, str(ROOT / "evaluation"))
import legacy  # noqa: E402  (evaluation/legacy.py)
import reader  # noqa: E402  (worker/reader.py)


# ---------------------------------------------------------------- worker

def test_worker_reads_old_variable_names(monkeypatch):
    monkeypatch.delenv("TRAFFIC_COUNTER_NO_NVDEC", raising=False)
    monkeypatch.setenv("CONTADOR_SEM_NVDEC", "1")
    assert reader.env("TRAFFIC_COUNTER_NO_NVDEC") == "1"


def test_worker_new_variable_wins(monkeypatch):
    monkeypatch.setenv("CONTADOR_FFMPEG", "/old/ffmpeg")
    monkeypatch.setenv("TRAFFIC_COUNTER_FFMPEG", "/new/ffmpeg")
    assert reader.env("TRAFFIC_COUNTER_FFMPEG") == "/new/ffmpeg"


def test_worker_uses_old_ffmpeg_variable(monkeypatch, tmp_path):
    exe = tmp_path / "ffmpeg.exe"
    exe.write_bytes(b"")
    monkeypatch.delenv("TRAFFIC_COUNTER_FFMPEG", raising=False)
    monkeypatch.setenv("CONTADOR_FFMPEG", str(exe))
    assert reader._ffmpeg() == str(exe)


# ---------------------------------------------------------------- avaliacao/ → evaluation/

@pytest.fixture
def folders(tmp_path, monkeypatch):
    """A clone after `git pull`: the scripts in evaluation/, the untracked
    videos and outputs left in avaliacao/."""
    new, old = tmp_path / "evaluation", tmp_path / "avaliacao"
    new.mkdir()
    old.mkdir()
    monkeypatch.setattr(legacy, "HERE", new)
    monkeypatch.setattr(legacy, "OLD_DIR", old)
    return new, old


def test_local_prefers_the_new_folder(folders):
    new, old = folders
    (new / "videos").mkdir()
    (old / "videos").mkdir()
    assert legacy.local("videos") == new / "videos"


def test_local_finds_what_stayed_in_avaliacao(folders):
    new, old = folders
    (old / "videos").mkdir()
    (old / "varredura_v9").mkdir()
    assert legacy.local("videos") == old / "videos"
    assert legacy.local("sweep_v9", "varredura_v9") == old / "varredura_v9"


def test_local_old_name_in_the_new_folder(folders):
    new, _ = folders
    (new / "varredura_dual").mkdir()
    assert legacy.local("sweep_dual", "varredura_dual") == new / "varredura_dual"


def test_local_new_path_when_nothing_exists(folders):
    new, _ = folders
    assert legacy.local("dataset") == new / "dataset"


def test_mining_dir_in_avaliacao(folders):
    new, old = folders
    (old / "mineracao").mkdir()
    assert legacy.mining_dir(new) == old / "mineracao"
    assert legacy.mining_dir() == old / "mineracao"


def test_real_folders():
    assert legacy.HERE == ROOT / "evaluation"
    assert legacy.OLD_DIR == ROOT / "avaliacao"


# ---------------------------------------------------------------- old outputs

def test_old_diagnostic_folder(tmp_path):
    (tmp_path / "eventos.jsonl").write_text(json.dumps(
        {"categoria": "ciclistas", "frame_video": 10, "motivo": "reid_oposto", "lado": "dir"}) + "\n",
        encoding="utf-8")
    (tmp_path / "resumo.json").write_text(json.dumps(
        {"totais": {"ciclistas": 2, "automoveis": 5},
         "por_motivo": {"ciclistas": {"centroide": 1, "tela": 1}}}), encoding="utf-8")
    assert legacy.load_events(tmp_path) == [
        {"category": "cyclists", "video_frame": 10, "reason": "reid_opposite", "side": "right"}]
    s = legacy.load_summary(tmp_path)
    assert s["totals"] == {"cyclists": 2, "cars": 5}
    assert s["by_reason"] == {"cyclists": {"centroid": 1, "screen": 1}}


def test_old_mined_candidates(tmp_path):
    (tmp_path / "candidatos.json").write_text(json.dumps(
        [{"hora": "17", "tempo_s": 3.5, "fonte": "yolo", "caixa": [1, 2, 3, 4], "y_centro": 9}]),
        encoding="utf-8")
    assert legacy.load_mined_candidates(tmp_path) == [
        {"hour": "17", "time_s": 3.5, "source": "yolo", "box": [1, 2, 3, 4], "y_center": 9}]

