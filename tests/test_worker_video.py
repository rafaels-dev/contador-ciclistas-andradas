"""Ponta a ponta do worker: um vídeo sintético com um bloco que atravessa a
linha passa por worker/detectar.py de verdade (leitura com FFmpeg, YOLO,
subtração de fundo, candidatos, filmstrip, contexto e clipe). O YOLO não
reconhece o bloco — quem o pega é o movimento, como os ciclistas borrados."""
import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

RAIZ = Path(__file__).resolve().parent.parent
LARGURA, ALTURA, FPS, SEGUNDOS = 640, 360, 15, 8


def gravar_video(destino: Path, para_direita: bool) -> None:
    rng = np.random.default_rng(0)
    fundo = cv2.GaussianBlur(rng.integers(90, 160, (ALTURA, LARGURA, 3), dtype=np.uint8), (0, 0), 3)
    escritor = cv2.VideoWriter(str(destino), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (LARGURA, ALTURA))
    inicio, fim = int(3.5 * FPS), int(7.0 * FPS)  # o fundo do MOG2 aquece por 3 s
    for i in range(SEGUNDOS * FPS):
        q = fundo.copy()
        if inicio <= i <= fim:
            f = (i - inicio) / (fim - inicio)
            x = int(40 + f * (LARGURA - 120)) if para_direita else int(LARGURA - 80 - f * (LARGURA - 120))
            cv2.rectangle(q, (x, 170), (x + 40, 250), (20, 20, 20), -1)
        escritor.write(q)
    escritor.release()


def detectar(tmp_path: Path, para_direita: bool) -> list[dict]:
    tmp_path.mkdir()
    video = tmp_path / "sintetico.mp4"
    gravar_video(video, para_direita)
    linhas = tmp_path / "linhas.json"
    linhas.write_text(json.dumps([{"id": "l1", "nome": "Linha 1", "x1": 0.5, "y1": 0.4, "x2": 0.5, "y2": 0.9}]))
    saida = tmp_path / "candidatos"
    env = {**os.environ, "CONTADOR_SEM_NVDEC": "1", "PYTHONUTF8": "1"}
    r = subprocess.run([sys.executable, str(RAIZ / "worker" / "detectar.py"), "--video", str(video),
                        "--saida", str(saida), "--linhas", str(linhas)],
                       capture_output=True, text=True, encoding="utf-8", env=env, timeout=600)
    eventos = [json.loads(l) for l in r.stdout.splitlines() if l.startswith("{")]
    assert r.returncode == 0, r.stderr[-3000:]
    assert eventos[-1]["tipo"] == "fim", eventos[-3:]
    assert not (tmp_path / "previa.jpg").exists(), "a prévia deve ser apagada ao terminar"
    cands = json.loads((saida / "candidatos.json").read_text(encoding="utf-8"))
    for c in cands:
        for campo in ("filmstrip", "contexto", "clipe"):
            assert (saida / c[campo]).stat().st_size > 0, c[campo]
    return cands


@pytest.mark.lento
def test_bloco_que_cruza_a_linha_vira_um_candidato(tmp_path):
    ida = detectar(tmp_path / "ida", para_direita=True)
    volta = detectar(tmp_path / "volta", para_direita=False)
    assert len(ida) == 1 and len(volta) == 1, (ida, volta)
    assert ida[0]["linha_id"] == "l1"
    assert {ida[0]["direcao"], volta[0]["direcao"]} == {"A→B", "B→A"}
    # cruza x = 320 no meio do movimento (≈ 5,25 s)
    assert 4.5 <= ida[0]["tempo_s"] <= 6.0
    # caixa em px do vídeo original, em volta do bloco
    x1, y1, x2, y2 = ida[0]["bbox"]
    assert 250 <= (x1 + x2) / 2 <= 390 and 230 <= y2 <= 270
