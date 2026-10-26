#!/usr/bin/env python3
"""
Detecção + rastreamento para o app de revisão (web/).

Diferente de contador/ (que decide a contagem online, frame a frame, com
uma linha vertical fixa), aqui o vídeo inteiro é processado primeiro e a
decisão é tomada sobre as TRAJETÓRIAS COMPLETAS — o que permite linhas de
contagem em qualquer ângulo e deixa a palavra final para a revisão humana.

Passo 1 (sequencial): mesmos modelos do contador (COCO + bicicletas
  fine-tuned), 4 ByteTracks (pessoas, bicicletas, automóveis, motos).
  Cada track guarda as caixas por frame, votos de classe, associação
  pessoa↔bicicleta/moto e alguns recortes (para o filmstrip).
  Em paralelo, subtração de fundo: manchas em movimento que nenhuma caixa
  do YOLO explica viram um 5º ByteTrack ("movimento" → categoria outros) —
  tudo que se move e cruza a linha chega à revisão, mesmo sem modelo.
Pós-processamento: gera candidatos
  - com linhas: 1º cruzamento do ponto de contato com o chão (base-centro
    da caixa) com cada segmento desenhado; direção A→B / B→A.
  - sem linhas: toda trajetória com deslocamento relevante.
  Pessoa associada a bicicleta/moto que também gerou candidato é o
  ciclista/motociclista → some (o veículo já representa o objeto).
Passo 2 (sequencial): um clipe curto H.264 por candidato, recortado em
  torno do objeto, com a caixa e as linhas desenhadas.

Uso:
  python worker/detectar.py --video V.mp4 --saida DIR [--linhas linhas.json]
                            [--inicio S] [--fim S]
Saída: DIR/candidatos.json, DIR/filmstrips/*.jpg, DIR/clipes/*.mp4 e,
no stdout, uma linha JSON por evento ({"tipo": "progresso"|"fim"|"erro"}).

IMPORTANTE: nada de cap.set(POS_FRAMES) — o seek desses arquivos de DVR
cai ~30 s antes do pedido (ver CLAUDE.md). Tudo é lido sequencialmente.
"""
from __future__ import annotations

import argparse
import bisect
import gzip
import json
import os
import sys

# os eventos JSON levam "→" e "…": no Windows o stdout nasce em cp1252
if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
import time
import warnings
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

warnings.filterwarnings("ignore", category=FutureWarning, module="supervision")
import supervision as sv  # noqa: E402
from ultralytics import YOLO  # noqa: E402

import config  # noqa: E402
from leitor import LeitorVideo, area_em_px, gravar_jpg, info_video  # noqa: E402

_PERSON, _BICYCLE, _MOTORCYCLE = 0, 1, 3

GRUPOS = ("pes", "bic", "aut", "mot", "mov")
CATEGORIA_GRUPO = {"pes": "pedestres", "bic": "ciclistas", "aut": "automoveis", "mot": "motocicletas",
                   "mov": "outros"}

TRILHAS_VERSAO = 2       # 2: inclui o grupo "mov"; trilhas mais antigas forçam nova detecção
                         # (meta["area"]: recorte analisado; trilhas de outra área também)
MIN_OBS = 3              # observações mínimas (após emendas) para virar candidato
MAX_RECORTES = 10        # recortes guardados por track (filmstrip)
DESLOC_MIN_FRAC = 0.12   # sem linhas: deslocamento mínimo (fração da diagonal)
JANELA_PAREAR_S = 3.0    # pessoa↔veículo: eventos a até ±3 s são o mesmo objeto
CLIPE_S = 1.5            # meia-janela do clipe (s)

# movimento sem modelo (subtração de fundo numa cópia reduzida do quadro)
MOV_LARGURA = 480        # largura da máscara de movimento (px)
MOV_AREA_MIN = 40        # área mínima da mancha na máscara (px; ~25×25 em 1080p)
MOV_AREA_MAX = 0.25      # mancha maior que isso do quadro = troca de exposição/IR, ignora
MOV_EXPLICADO = 0.3      # fração da mancha dentro de caixas do YOLO → já é um objeto conhecido
MOV_AQUECER_S = 3.0      # o modelo de fundo precisa de alguns segundos para estabilizar
MOV_MIN_S = 0.6          # track de movimento: duração mínima
MOV_DESLOC_ALTURAS = 1.5 # ... e deslocamento mínimo, em alturas da própria caixa
# Na área de análise a máscara é fina (até 1 px do 4K) e o ruído passa: manchas
# de 10–20 px (compressão, sol entre as folhas) que o tracker encadeia numa
# "trilha" que anda pouco. Medidas em px de um quadro 1080p (÷ escala). Augusto
# de Lima (06h, área 768×468): os 30 descartados tinham p90 da área < 1100 ou
# andavam < 110; ciclistas, pedestres e patinetes, p90 ≥ 1900 e ≥ 160.
MOV_FINO_VERSAO = 3       # sobe quando a detecção na área muda (trilhas antigas são refeitas)
MOV_FINO_AREA_P90 = 1000  # px²: o objeto precisa ter esse tamanho em algum momento
MOV_FINO_DESLOC = 120     # px: deslocamento mínimo do início ao fim
LARGO_FAIXA = 3.0        # linha que não conta automóveis (ciclovia, calçada): objeto com
                         # comprimento, no sentido da travessia, > 3× a linha não cabe na faixa
                         # (carro/ônibus na pista ao lado cuja base invade a ciclovia)


def emitir(**dados) -> None:
    print(json.dumps(dados, ensure_ascii=False), flush=True)


@dataclass
class Track:
    grupo: str
    tid: int
    frames: list[int] = field(default_factory=list)
    caixas: list[tuple[float, float, float, float]] = field(default_factory=list)
    classes: Counter = field(default_factory=Counter)
    conf_soma: float = 0.0
    recortes: list[tuple[int, bytes]] = field(default_factory=list)
    passo_recorte: int = 1
    # associação (só pessoas): frames com bicicleta/moto perto e quais tracks
    n_bike: int = 0
    n_moto: int = 0
    vizinhos: Counter = field(default_factory=Counter)
    emendas: list[str] = field(default_factory=list)  # chaves dos pedaços emendados

    @property
    def chave(self) -> str:
        return f"{self.grupo}:{self.tid}"

    @property
    def n(self) -> int:
        return len(self.frames)

    def associado(self) -> str | None:
        """Mesmos critérios do contador (v5/v7)."""
        if self.grupo != "pes":
            return None
        if self.n_moto >= 2 and self.n_moto / self.n >= 0.5:
            return "mot"
        if self.n_bike / self.n >= 0.3 or (self.n_bike >= 2 and self.n <= 10):
            return "bic"
        return None


# ----------------------------------------------------------------------
# Geometria
# ----------------------------------------------------------------------

def _lado(a, b, p) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def cruzamento(a, b, p, q) -> float | None:
    """Fração t∈[0,1] ao longo de p→q em que o movimento cruza o segmento
    a–b, ou None. Mesma convenção de lados da UI: lado A tem cross < 0."""
    d1, d2 = _lado(a, b, p), _lado(a, b, q)
    if d1 == 0 or d1 * d2 > 0:
        return None
    d3, d4 = _lado(p, q, a), _lado(p, q, b)
    if d3 * d4 > 0:
        return None
    return d1 / (d1 - d2)


def ponto_chao(caixa) -> tuple[float, float]:
    x1, _, x2, y2 = caixa
    return ((x1 + x2) / 2, y2)


# ----------------------------------------------------------------------
# Passo 1
# ----------------------------------------------------------------------

def _recortar(frame, caixa, grupo: str) -> bytes:
    h_img, w_img = frame.shape[:2]
    x1, y1, x2, y2 = caixa
    w, h = x2 - x1, y2 - y1
    topo = h * (1.2 if grupo in ("bic", "mot") else 0.25)  # inclui o condutor
    x1, x2 = x1 - w * 0.25, x2 + w * 0.25
    y1, y2 = y1 - topo, y2 + h * 0.15
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w_img, int(x2)), min(h_img, int(y2))
    img = frame[y1:y2, x1:x2]
    escala = 200 / max(img.shape[:2])
    if escala < 1:
        img = cv2.resize(img, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes() if ok else b""


def _registrar(tracks: dict, grupo: str, dets: sv.Detections, frame, idx: int,
               guardar_recortes: bool = True) -> None:
    if not len(dets) or dets.tracker_id is None:
        return
    for k, tid in enumerate(dets.tracker_id):
        chave = f"{grupo}:{int(tid)}"
        tr = tracks.get(chave)
        if tr is None:
            tr = tracks[chave] = Track(grupo, int(tid))
        caixa = tuple(float(v) for v in dets.xyxy[k])
        tr.frames.append(idx)
        tr.caixas.append(caixa)
        if dets.class_id is not None:
            tr.classes[int(dets.class_id[k])] += 1
        if dets.confidence is not None:
            tr.conf_soma += float(dets.confidence[k])
        if guardar_recortes and (tr.n - 1) % tr.passo_recorte == 0:
            tr.recortes.append((idx, _recortar(frame, caixa, grupo)))
            if len(tr.recortes) > MAX_RECORTES:
                tr.recortes = tr.recortes[::2]
                tr.passo_recorte *= 2


def _associar(tracks: dict, pessoas, bicicletas, motos, escala: float) -> None:
    """Pessoa ↔ bicicleta/moto, anisotrópico (|dx|≤120, |dy|≤250 em 1080p):
    o condutor fica ~200 px acima do centro do veículo."""
    if not len(pessoas) or pessoas.tracker_id is None:
        return
    dx_max, dy_max = 120 * escala, 250 * escala
    pc = np.column_stack([(pessoas.xyxy[:, 0] + pessoas.xyxy[:, 2]) / 2,
                          (pessoas.xyxy[:, 1] + pessoas.xyxy[:, 3]) / 2])
    for grupo, veic in (("bic", bicicletas), ("mot", motos)):
        if not len(veic) or veic.tracker_id is None:
            continue
        vc = np.column_stack([(veic.xyxy[:, 0] + veic.xyxy[:, 2]) / 2,
                              (veic.xyxy[:, 1] + veic.xyxy[:, 3]) / 2])
        for i, ptid in enumerate(pessoas.tracker_id):
            dx = np.abs(vc[:, 0] - pc[i, 0])
            dy = np.abs(vc[:, 1] - pc[i, 1])
            perto = np.where((dx <= dx_max) & (dy <= dy_max))[0]
            if not len(perto):
                continue
            tr = tracks[f"pes:{int(ptid)}"]
            if grupo == "bic":
                tr.n_bike += 1
            else:
                tr.n_moto += 1
            j = perto[np.argmin(dx[perto] + dy[perto])]
            tr.vizinhos[f"{grupo}:{int(veic.tracker_id[j])}"] += 1


class Movimento:
    """Manchas em movimento não explicadas pelo YOLO, como sv.Detections no
    espaço do quadro processado. Sombras (MOG2 marca 127) ficam de fora —
    menos na área de análise (`fino`): lá o objeto é pequeno e borrado (o
    ciclista distante da Augusto de Lima), e o MOG2 marca a maior parte dele
    como sombra; o que sobra se parte em pedaços. Contando a sombra e fechando
    com um núcleo maior, ele volta a ser uma mancha só."""

    def __init__(self, largura: int, altura: int, fps: float, s: float | None = None, fino: bool = False):
        self.s = s or MOV_LARGURA / largura
        self.fino = fino
        self.limiar = 100 if fino else 200
        self.tam = (max(1, int(round(largura * self.s))), max(1, int(round(altura * self.s))))
        self.fundo = cv2.createBackgroundSubtractorMOG2(history=int(20 * fps), varThreshold=25,
                                                        detectShadows=True)
        self.aquecer = int(MOV_AQUECER_S * fps)
        self.n = 0
        self.k_abre = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.k_fecha = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11) if fino else (7, 7))

    def detectar(self, frame, conhecidos: list[sv.Detections]) -> sv.Detections:
        pequeno = cv2.resize(frame, self.tam, interpolation=cv2.INTER_AREA)
        mascara = self.fundo.apply(pequeno)
        self.n += 1
        if self.n <= self.aquecer:
            return sv.Detections.empty()
        _, m = cv2.threshold(mascara, self.limiar, 255, cv2.THRESH_BINARY)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, self.k_abre)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, self.k_fecha)
        # Na área de análise (câmera alta), a caixa do carro da faixa colada ao
        # meio-fio desce sobre a ciclovia: alargada, ela "explicava" o ciclista
        # ao lado, e a mancha dos dois saía emendada. Lá, carro conta só pela
        # caixa justa, e o que está dentro dela sai da máscara (Augusto de Lima
        # 81 e 117 min: o ciclista colado no carro volta a ser candidato).
        justo = self.fino
        if justo:
            for d in conhecidos:
                if not len(d):
                    continue
                for (x1, y1, x2, y2), c in zip(d.xyxy * self.s, d.class_id):
                    if c in config.CLASSES_AUTOMOVEIS:
                        m[max(0, int(y1)):int(y2), max(0, int(x1)):int(x2)] = 0
        n, rot, est, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        if n <= 1:
            return sv.Detections.empty()
        # caixas do YOLO, alargadas para os lados e para baixo (rodas, pernas,
        # sombra colada): mancha majoritariamente dentro delas já tem modelo
        cobre = np.zeros(m.shape, np.uint8)
        for d in conhecidos:
            if not len(d):
                continue
            for (x1, y1, x2, y2), c in zip(d.xyxy * self.s, d.class_id):
                w, h = x2 - x1, y2 - y1
                if justo and c in config.CLASSES_AUTOMOVEIS:
                    continue
                cv2.rectangle(cobre, (int(x1 - 0.3 * w), int(y1 - 0.1 * h)),
                              (int(x2 + 0.3 * w), int(y2 + 0.5 * h)), 1, -1)
        dentro = np.bincount(rot[cobre > 0], minlength=n)
        area_max = MOV_AREA_MAX * m.size
        caixas = []
        for i in range(1, n):
            x, y, w, h, area = est[i]
            if area < MOV_AREA_MIN or area > area_max or dentro[i] / area >= MOV_EXPLICADO:
                continue
            caixas.append((x, y, x + w, y + h))
        if not caixas:
            return sv.Detections.empty()
        xyxy = np.array(caixas, np.float32) / self.s
        return sv.Detections(xyxy=xyxy, confidence=np.full(len(xyxy), 0.5, np.float32),
                             class_id=np.full(len(xyxy), -1, int))


# cores das caixas na prévia (BGR; as mesmas de COR em renderizar.py)
COR_PREVIA = {"pes": (240, 130, 61), "bic": (98, 191, 47), "aut": (32, 123, 244),
              "mot": (234, 75, 210), "mov": (147, 154, 160)}


def gravar_previa(destino: Path, frame, rastreados: dict, mov, linhas: list[dict]) -> None:
    """O quadro que está sendo analisado, com as caixas e as linhas: a página
    mostra durante a detecção, para o usuário ver que ela anda."""
    img = frame.copy()
    h, w = img.shape[:2]
    esp = max(2, round(w / 640))
    for l in linhas:
        cv2.line(img, (round(l["x1"] * w), round(l["y1"] * h)), (round(l["x2"] * w), round(l["y2"] * h)),
                 (21, 204, 250), esp + 1, cv2.LINE_AA)
    for g, d in [*rastreados.items(), ("mov", mov)]:
        for x1, y1, x2, y2 in d.xyxy:
            cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), COR_PREVIA[g], esp)
    if w > 1280:
        img = cv2.resize(img, (1280, round(h * 1280 / w)), interpolation=cv2.INTER_AREA)
    tmp = destino.with_suffix(".tmp")
    gravar_jpg(tmp, img, 75)
    try:
        os.replace(tmp, destino)
    except OSError:
        pass  # Windows: o servidor está lendo a anterior — fica para a próxima


def passo_deteccao(video: str, inicio_f: int, fim_f: int | None,
                   imgsz_forcado: int | None = None, lote: int = 8, area=None,
                   previa: Path | None = None, linhas_previa: list[dict] = ()):
    """Retorna (tracks, escala, leitor_info). Coordenadas no espaço do quadro
    processado (≤ 1920 px de largura, ou o recorte da área; ver leitor.py).
    Com `previa`, grava ali um JPEG do quadro atual a cada segundo."""
    modelo = YOLO(str(RAIZ / config.MODELO) if (RAIZ / config.MODELO).exists() else config.MODELO)
    mb = getattr(config, "MODELO_BICICLETAS", None)
    modelo_bic = YOLO(str(RAIZ / mb)) if mb else None
    conf, iou = config.CONFIANCA, config.IOU
    classes = sorted({_PERSON, _BICYCLE, _MOTORCYCLE, *config.CLASSES_AUTOMOVEIS})
    trackers = {g: sv.ByteTrack() for g in GRUPOS}

    def por_classe(d: sv.Detections, ids) -> sv.Detections:
        if not len(d):
            return d
        return d[np.isin(d.class_id, ids)]

    leitor = LeitorVideo(video, area=area)
    escala = escala_do(leitor)
    # máscara de movimento: no recorte, mais fina (até 960 px) — é o mesmo
    # objeto pequeno que motivou o recorte
    movimento = Movimento(leitor.largura, leitor.altura, leitor.info["fps"],
                          s=min(1.0, 960 / leitor.largura) if area else None, fino=bool(area))
    imgsz = imgsz_forcado
    if imgsz is None and area:
        # o recorte já está na resolução que importa: inferência no tamanho
        # dele (até 1280; recortes menores o YOLO amplia, o que ajuda)
        imgsz = min(1280, max(640, int(round(max(leitor.largura, leitor.altura) / 32)) * 32))
    elif imgsz is None:
        # resolução de inferência acompanha o vídeo ORIGINAL: em 4K, 640 px
        # encolhe o quadro 6× e objetos pequenos (ciclistas numa vista
        # alta) somem; 1080p → 640, 4K → 1280
        base = getattr(config, "IMGSZ", 640)
        imgsz = int(round(base * max(1.0, leitor.info["altura"] / 1080) / 32) * 32)
    emitir(tipo="progresso", etapa="detectando", p=0, imgsz=imgsz, nvdec=leitor.gpu)
    if previa is not None:
        previa.unlink(missing_ok=True)  # a de uma detecção anterior (outra área)

    tracks: dict[str, Track] = {}
    total_f = leitor.info["frames"]
    alvo = (fim_f if fim_f is not None else total_f) - inicio_f
    idx = -1
    while idx + 1 < inicio_f and leitor.pular():
        idx += 1
    t0 = time.time()
    ultimo_emit = 0.0
    acabou = False

    while not acabou:
        # inferência em lote: a GPU fica ociosa com um quadro por chamada
        quadros, indices = [], []
        while len(quadros) < lote:
            if fim_f is not None and idx + 1 >= fim_f:
                acabou = True
                break
            f = leitor.ler()
            if f is None:
                acabou = True
                break
            idx += 1
            quadros.append(f)
            indices.append(idx)
        if not quadros:
            break

        rs = modelo(quadros, conf=conf, iou=iou, imgsz=imgsz, classes=classes,
                    agnostic_nms=True, verbose=False)
        rbs = (modelo_bic(quadros, conf=conf, iou=iou, imgsz=imgsz, classes=[_BICYCLE], verbose=False)
               if modelo_bic is not None else [None] * len(quadros))

        for frame, i, r, rb in zip(quadros, indices, rs, rbs):
            tudo = sv.Detections.from_ultralytics(r)
            bikes = sv.Detections.from_ultralytics(rb) if rb is not None else por_classe(tudo, [_BICYCLE])
            if rb is not None and area:
                # o modelo ajustado é da câmera de Andradas (vista lateral);
                # na Augusto de Lima (alta, 4K) ele não pega nada e o COCO pega
                coco = por_classe(tudo, [_BICYCLE])
                if len(coco):
                    bikes = sv.Detections.merge([bikes, coco]).with_nms(threshold=0.5, class_agnostic=True) if len(bikes) else coco
            motos = por_classe(tudo, config.CLASSES_MOTOCICLETAS)
            if area and len(motos):
                # o COCO alterna bicicleta/moto no mesmo ciclista pequeno; com um
                # rastreador por classe, nenhum formava trilha. Na área, duas
                # rodas são um grupo só — a classe quem decide é o modelo de visão
                bikes = sv.Detections.merge([bikes, motos]).with_nms(threshold=0.5, class_agnostic=True) if len(bikes) else motos
                motos = sv.Detections.empty()
            rastreados = {
                "pes": trackers["pes"].update_with_detections(por_classe(tudo, [_PERSON])),
                "bic": trackers["bic"].update_with_detections(bikes),
                "aut": trackers["aut"].update_with_detections(por_classe(tudo, config.CLASSES_AUTOMOVEIS)),
                "mot": trackers["mot"].update_with_detections(motos),
            }
            for g, d in rastreados.items():
                # recortes do filmstrip saem da 2ª leitura (passo_midias), só
                # para os candidatos — não precisa guardar de todos os tracks
                _registrar(tracks, g, d, frame, i, guardar_recortes=False)
            _associar(tracks, rastreados["pes"], rastreados["bic"], rastreados["mot"], escala)
            # caixas cruas do YOLO (não só as rastreadas): um objeto que o
            # tracker ainda não confirmou não deve virar "outros"
            mov = movimento.detectar(frame, [tudo, bikes])
            _registrar(tracks, "mov", trackers["mov"].update_with_detections(mov), frame, i,
                       guardar_recortes=False)

        agora = time.time()
        if agora - ultimo_emit >= 1.0:
            ultimo_emit = agora
            if previa is not None:
                gravar_previa(previa, frame, rastreados, mov, linhas_previa)
            feitos = idx + 1 - inicio_f
            emitir(tipo="progresso", etapa="detectando",
                   p=min(feitos / alvo, 1.0) if alvo > 0 else 0,
                   fps=round(feitos / (agora - t0), 1), frame=idx)
    leitor.fechar()
    if previa is not None:  # um arquivo só, sobrescrito; some quando a detecção acaba
        previa.unlink(missing_ok=True)
        previa.with_suffix(".tmp").unlink(missing_ok=True)
    return tracks, escala, leitor


# ----------------------------------------------------------------------
# Emenda de trajetórias
# ----------------------------------------------------------------------

def escala_do(leitor) -> float:
    """Densidade de pixels em relação a um quadro inteiro de 1080p: os limites
    em px do worker (associação, emendas, clipes) foram ajustados nele. No
    recorte 4K em resolução cheia, um objeto tem 2× os pixels → escala 2."""
    return leitor.info["altura"] / (leitor.fator * 1080)


def linhas_no_quadro(linhas: list[dict], meta: dict) -> list[dict]:
    """Linhas (0–1 do quadro original) → 0–1 do quadro processado (a área)."""
    area = meta.get("area")
    if not area:
        return linhas
    W, H = meta["original"]
    ox, oy, w, h = area
    return [{**l, "x1": (l["x1"] * W - ox) / w, "y1": (l["y1"] * H - oy) / h,
             "x2": (l["x2"] * W - ox) / w, "y2": (l["y2"] * H - oy) / h} for l in linhas]


def caixa_no_original(c, meta: dict) -> list[float]:
    ox, oy = (meta.get("area") or (0, 0))[:2]
    f = meta["fator"]
    return [round(ox + c[0] * f, 1), round(oy + c[1] * f, 1), round(ox + c[2] * f, 1), round(oy + c[3] * f, 1)]


def _velocidade(tr: Track, ultimos: int = 6) -> tuple[float, float]:
    """px/frame do ponto de contato nas últimas observações."""
    k = min(ultimos, tr.n - 1)
    if k < 1:
        return 0.0, 0.0
    p0, p1 = ponto_chao(tr.caixas[-1 - k]), ponto_chao(tr.caixas[-1])
    df = max(1, tr.frames[-1] - tr.frames[-1 - k])
    return (p1[0] - p0[0]) / df, (p1[1] - p0[1]) / df


def emendar_tracks(tracks: dict, fps: float, escala: float) -> dict:
    """O ByteTrack às vezes perde o objeto por alguns frames (oclusão, blur)
    e o retoma com um id NOVO — se isso acontece em cima da linha, nenhum
    dos dois pedaços cruza. Emenda B em A quando B nasce até ~2 s depois da
    morte de A, no mesmo grupo, perto de onde A estaria seguindo sua
    velocidade (substitui o centroide_gap/reid_oposto de contador/linha.py)."""
    gap_max = int(2.0 * fps)
    por_grupo: dict[str, list[Track]] = {}
    for tr in tracks.values():
        por_grupo.setdefault(tr.grupo, []).append(tr)

    pai: dict[str, str] = {}  # chave B → chave A (B continua A)
    for lista in por_grupo.values():
        lista.sort(key=lambda t: t.frames[0])
        fins = sorted(lista, key=lambda t: t.frames[-1])
        tem_sucessor: set[str] = set()
        for b in lista:
            melhor, melhor_d = None, None
            pb = ponto_chao(b.caixas[0])
            for a in fins:
                gap = b.frames[0] - a.frames[-1]
                if gap > gap_max:
                    continue
                if gap <= 0:
                    break  # fins ordenados: os demais também se sobrepõem a B
                if a.chave in tem_sucessor or a.n < 2:
                    continue
                vx, vy = _velocidade(a)
                pa = ponto_chao(a.caixas[-1])
                prev = (pa[0] + vx * gap, pa[1] + vy * gap)
                altura = a.caixas[-1][3] - a.caixas[-1][1]
                tol = max(80 * escala, 0.6 * altura) + 0.5 * np.hypot(vx, vy) * gap
                d = np.hypot(pb[0] - prev[0], pb[1] - prev[1])
                if d <= tol and (melhor_d is None or d < melhor_d):
                    melhor, melhor_d = a, d
            if melhor is not None:
                pai[b.chave] = melhor.chave
                tem_sucessor.add(melhor.chave)

    def raiz(chave: str) -> str:
        while chave in pai:
            chave = pai[chave]
        return chave

    cadeias: dict[str, list[Track]] = {}
    for tr in tracks.values():
        cadeias.setdefault(raiz(tr.chave), []).append(tr)

    resultado: dict[str, Track] = {}
    for partes in cadeias.values():
        partes.sort(key=lambda t: t.frames[0])
        if len(partes) == 1:
            resultado[partes[0].chave] = partes[0]
            continue
        novo = Track(partes[0].grupo, partes[0].tid)
        for p in partes:
            novo.frames += p.frames
            novo.caixas += p.caixas
            novo.classes += p.classes
            novo.conf_soma += p.conf_soma
            novo.recortes += p.recortes
            novo.n_bike += p.n_bike
            novo.n_moto += p.n_moto
            novo.vizinhos += p.vizinhos
        while len(novo.recortes) > MAX_RECORTES:
            novo.recortes = novo.recortes[::2]
        novo.emendas = [p.chave for p in partes]
        resultado[novo.chave] = novo

    # vizinhos de pessoas apontam para chaves antigas de veículos emendados
    for tr in resultado.values():
        if tr.vizinhos:
            tr.vizinhos = Counter({raiz(k): v for k, v in tr.vizinhos.items()})
    return resultado


# ----------------------------------------------------------------------
# Persistência das trilhas (permite refazer candidatos ao mudar as linhas
# sem repetir a detecção)
# ----------------------------------------------------------------------

def salvar_trilhas(caminho: Path, tracks: dict, meta: dict) -> None:
    lista = [{
        "grupo": t.grupo, "tid": t.tid, "frames": t.frames,
        "caixas": [[round(v, 1) for v in c] for c in t.caixas],
        "classes": dict(t.classes), "conf_soma": round(t.conf_soma, 3),
        "n_bike": t.n_bike, "n_moto": t.n_moto, "vizinhos": dict(t.vizinhos), "emendas": t.emendas,
    } for t in tracks.values() if t.n >= MIN_OBS]
    with gzip.open(caminho, "wt", encoding="utf-8") as f:
        json.dump({"meta": meta, "tracks": lista}, f)


def carregar_trilhas(caminho: Path) -> tuple[dict, dict]:
    with gzip.open(caminho, "rt", encoding="utf-8") as f:
        dados = json.load(f)
    tracks = {}
    for d in dados["tracks"]:
        t = Track(d["grupo"], d["tid"], frames=d["frames"], caixas=[tuple(c) for c in d["caixas"]],
                  classes=Counter({int(k): v for k, v in d["classes"].items()}), conf_soma=d["conf_soma"],
                  n_bike=d["n_bike"], n_moto=d["n_moto"], vizinhos=Counter(d["vizinhos"]), emendas=d["emendas"])
        tracks[t.chave] = t
    return tracks, dados["meta"]


def salvar_pontos(caminho: Path, tracks: dict, meta: dict, max_por_grupo: int = 4000) -> None:
    """Pontos de chão amostrados por categoria (coordenadas 0–1 do quadro
    original) — o editor de linhas mostra onde cada tipo de objeto realmente passa."""
    W, H = meta["original"]
    ox, oy = (meta.get("area") or (0, 0))[:2]
    f = meta["fator"]
    por_grupo: dict[str, list] = {}
    for t in tracks.values():
        if t.n < MIN_OBS:
            continue
        g = t.associado() or t.grupo
        passo = max(1, t.n // 12)
        for c in t.caixas[::passo]:
            x, y = ponto_chao(c)
            por_grupo.setdefault(CATEGORIA_GRUPO[g], []).append([round((ox + x * f) / W, 4), round((oy + y * f) / H, 4)])
    rng = np.random.default_rng(0)
    for g, pts in por_grupo.items():
        if len(pts) > max_por_grupo:
            por_grupo[g] = [pts[i] for i in sorted(rng.choice(len(pts), max_por_grupo, replace=False))]
    caminho.write_text(json.dumps(por_grupo), encoding="utf-8")


# ----------------------------------------------------------------------
# Candidatos
# ----------------------------------------------------------------------

def _movimento_real(tr: Track, fps: float, escala: float = 1.0, fino: bool = False) -> bool:
    """Track só de subtração de fundo: precisa durar e se deslocar de verdade
    (folhas, chuva e faróis piscando ficam no lugar). Na área de análise
    (`fino`), também ter tamanho de objeto e andar uma distância mínima."""
    if tr.frames[-1] - tr.frames[0] < MOV_MIN_S * fps:
        return False
    alturas = sorted(c[3] - c[1] for c in tr.caixas)
    p0, p1 = ponto_chao(tr.caixas[0]), ponto_chao(tr.caixas[-1])
    desloc = np.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if desloc < MOV_DESLOC_ALTURAS * alturas[len(alturas) // 2]:
        return False
    if fino:
        areas = [(c[2] - c[0]) * (c[3] - c[1]) for c in tr.caixas]
        if np.percentile(areas, 90) < MOV_FINO_AREA_P90 * escala ** 2 or desloc < MOV_FINO_DESLOC * escala:
            return False
    return True


def _largo_demais(tr: Track, j: int, a, b) -> bool:
    """Comprimento da caixa ao longo da normal da linha (mediana perto do
    cruzamento) maior que LARGO_FAIXA × o comprimento da linha."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = max(1e-6, (dx * dx + dy * dy) ** 0.5)
    nx, ny = abs(dy) / L, abs(dx) / L
    ext = sorted(nx * (c[2] - c[0]) + ny * (c[3] - c[1]) for c in tr.caixas[max(0, j - 3):j + 4])
    return ext[len(ext) // 2] > LARGO_FAIXA * L


def gerar_candidatos(tracks: dict, linhas: list[dict], largura: int, altura: int,
                     fps: float, escala: float, fino: bool = False) -> list[dict]:
    segs = [(l["id"], (l["x1"] * largura, l["y1"] * altura), (l["x2"] * largura, l["y2"] * altura))
            for l in linhas]
    so_faixa = {l["id"] for l in linhas
                if l.get("categorias") and "automoveis" not in l["categorias"]}
    diag = (largura ** 2 + altura ** 2) ** 0.5
    eventos: list[dict] = []

    for tr in tracks.values():
        if tr.n < MIN_OBS:
            continue
        if tr.grupo == "mov" and not _movimento_real(tr, fps, escala, fino):
            continue
        base = {"track": tr.chave, "grupo": tr.grupo, "_tr": tr}
        if segs:
            pts = [ponto_chao(c) for c in tr.caixas]
            for lid, a, b in segs:
                for i in range(tr.n - 1):
                    t = cruzamento(a, b, pts[i], pts[i + 1])
                    if t is None:
                        continue
                    j = i if t < 0.5 else i + 1
                    if lid in so_faixa and _largo_demais(tr, j, a, b):
                        break
                    eventos.append({**base, "linha_id": lid,
                                    "frame": int(round(tr.frames[i] + t * (tr.frames[i + 1] - tr.frames[i]))),
                                    "direcao": "A→B" if _lado(a, b, pts[i]) < 0 else "B→A",
                                    "bbox": tr.caixas[j]})
                    break  # um candidato por track e linha
        else:
            p0, p1 = ponto_chao(tr.caixas[0]), ponto_chao(tr.caixas[-1])
            if np.hypot(p1[0] - p0[0], p1[1] - p0[1]) < DESLOC_MIN_FRAC * diag:
                continue
            j = tr.n // 2
            eventos.append({**base, "linha_id": None, "frame": tr.frames[j],
                            "direcao": None, "bbox": tr.caixas[j]})

    # Pessoa associada a bicicleta/moto: se o veículo também gerou evento na
    # mesma linha e perto no tempo, é o condutor/garupa → sai. Sem evento do
    # veículo (detecção falhou), a pessoa fica, mas a sugestão do YOLO passa
    # a ser a do veículo.
    janela = JANELA_PAREAR_S * fps
    por_track = {}
    for ev in eventos:
        por_track.setdefault((ev["track"], ev["linha_id"]), ev)
    veic = [ev for ev in eventos if ev["grupo"] in ("bic", "mot")]
    finais = []
    for ev in eventos:
        tr: Track = ev["_tr"]
        assoc = tr.associado()
        ev["origem"] = "track"
        if assoc:
            vizinhos = {k for k, _ in tr.vizinhos.most_common(5)}
            cx = (ev["bbox"][0] + ev["bbox"][2]) / 2
            par = [v for v in veic if v["linha_id"] == ev["linha_id"]
                   and abs(v["frame"] - ev["frame"]) <= janela
                   and (v["track"] in vizinhos
                        or abs((v["bbox"][0] + v["bbox"][2]) / 2 - cx) <= 150 * escala)]
            if par:
                continue
            ev["grupo_sugerido"] = assoc
            ev["origem"] = "pessoa_com_" + ("bicicleta" if assoc == "bic" else "moto")
        finais.append(ev)

    # bicicleta × moto no mesmo objeto (COCO confunde duas rodas): fica o
    # track mais longo, com a outra classe registrada como alternativa
    finais.sort(key=lambda e: e["frame"])
    removidos = set()
    for i, a in enumerate(finais):
        if a["grupo"] not in ("bic", "mot") or id(a) in removidos:
            continue
        for b in finais[i + 1:]:
            if b["frame"] - a["frame"] > 0.5 * fps * 2:
                break
            if ({a["grupo"], b["grupo"]} != {"bic", "mot"} or b["linha_id"] != a["linha_id"]
                    or id(b) in removidos):
                continue
            if abs((a["bbox"][0] + a["bbox"][2]) / 2 - (b["bbox"][0] + b["bbox"][2]) / 2) > 150 * escala:
                continue
            fica, sai = (a, b) if a["_tr"].n >= b["_tr"].n else (b, a)
            fica["alternativa"] = CATEGORIA_GRUPO[sai["grupo"]]
            removidos.add(id(sai))
    finais = [e for e in finais if id(e) not in removidos]

    # movimento que coincide com um evento do YOLO (mesma linha, perto no
    # tempo e no espaço) é o mesmo objeto visto antes/depois do modelo pegar
    conhecidos = [e for e in finais if e["grupo"] != "mov"]
    def _repetido(ev) -> bool:
        cx = (ev["bbox"][0] + ev["bbox"][2]) / 2
        return any(c["linha_id"] == ev["linha_id"] and abs(c["frame"] - ev["frame"]) <= fps
                   and abs((c["bbox"][0] + c["bbox"][2]) / 2 - cx) <= 150 * escala for c in conhecidos)
    for ev in finais:
        if ev["grupo"] == "mov":
            ev["origem"] = "movimento"
    finais = [e for e in finais if e["grupo"] != "mov" or not _repetido(e)]

    for k, ev in enumerate(finais):
        tr = ev["_tr"]
        ev["id"] = k
        ev["tempo_s"] = round(ev["frame"] / fps, 2)
        ev["classe_yolo"] = CATEGORIA_GRUPO[ev.get("grupo_sugerido", ev["grupo"])]
        ev["conf_yolo"] = round(tr.conf_soma / tr.n, 3)
        ev["n_obs"] = tr.n
        ev["bbox"] = [round(v, 1) for v in ev["bbox"]]
    return finais


def salvar_filmstrip(tr: Track, destino: Path, n: int = 5) -> None:
    recs = tr.recortes
    if not recs:
        return
    pos = np.linspace(0, len(recs) - 1, min(n, len(recs))).round().astype(int)
    imgs = []
    h, w_max = 160, 480
    for p in pos:
        img = cv2.imdecode(np.frombuffer(recs[p][1], np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        # cada recorte cabe em w_max×h: manchas de movimento muito largas (a guia
        # inteira da calçada no amanhecer) viravam tiras de 8–14 mil px, e o
        # modelo de visão recusa imagem com lado > 8000 px ("Provider returned error")
        escala = min(h / img.shape[0], w_max / img.shape[1])
        img = cv2.resize(img, (max(1, round(img.shape[1] * escala)), max(1, round(img.shape[0] * escala))))
        if img.shape[0] < h:
            pad = h - img.shape[0]
            img = cv2.copyMakeBorder(img, pad // 2, pad - pad // 2, 0, 0, cv2.BORDER_CONSTANT, value=(32, 32, 32))
        imgs.append(img)
        imgs.append(np.full((h, 4, 3), 32, np.uint8))
    if imgs:
        gravar_jpg(destino, np.hstack(imgs[:-1]))


# ----------------------------------------------------------------------
# Passo 2: mídias dos candidatos (clipes, contextos, filmstrips)
# ----------------------------------------------------------------------

def _regiao_clipe(tr: Track, f0: int, f1: int, largura: int, altura: int, escala: float):
    cxs = [c for f, c in zip(tr.frames, tr.caixas) if f0 <= f <= f1] or tr.caixas
    x1 = min(c[0] for c in cxs); y1 = min(c[1] for c in cxs)
    x2 = max(c[2] for c in cxs); y2 = max(c[3] for c in cxs)
    pad = max(160 * escala, 0.5 * (y2 - y1))
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(largura, x2 + pad), min(altura, y2 + pad)
    w, h = x2 - x1, y2 - y1
    s = min(360 / h, 640 / w)
    ow, oh = int(w * s) // 2 * 2, int(h * s) // 2 * 2
    return int(x1), int(y1), int(x2), int(y2), max(ow, 2), max(oh, 2)


def _caixa_em(tr: Track, idx: int):
    """Caixa do track no quadro idx, interpolada entre as observações vizinhas
    quando ele caiu num buraco do rastreio (o cruzamento costuma cair entre
    duas detecções; sem caixa, o modelo de visão não sabe qual é o objeto)."""
    k = bisect.bisect_left(tr.frames, idx)
    if k < tr.n and tr.frames[k] == idx:
        return tr.caixas[k]
    if k == 0 or k == tr.n:
        return None
    f0, f1 = tr.frames[k - 1], tr.frames[k]
    t = (idx - f0) / (f1 - f0)
    return [a + t * (b - a) for a, b in zip(tr.caixas[k - 1], tr.caixas[k])]


def passo_midias(video: str, candidatos: list[dict], linhas: list[dict], saida: Path,
                 fps: float, largura: int, altura: int, escala: float, n_recortes: int = 5,
                 area=None) -> None:
    import imageio_ffmpeg

    dir_clipes = saida / "clipes"
    meia = int(CLIPE_S * fps)
    pend = sorted(candidatos, key=lambda c: c["frame"] - meia)
    if not pend:
        return
    # quadros de onde sai cada recorte do filmstrip (espalhados pela trajetória)
    recortes_em: dict[int, list] = {}
    for tr in {id(c["_tr"]): c["_tr"] for c in candidatos}.values():  # 1 vez por track
        tr.recortes = []
        for k in np.linspace(0, tr.n - 1, min(n_recortes, tr.n)).round().astype(int):
            recortes_em.setdefault(tr.frames[k], []).append((tr, tr.caixas[k]))
    segs = [((l["x1"] * largura, l["y1"] * altura), (l["x2"] * largura, l["y2"] * altura)) for l in linhas]
    ativos: list[dict] = []
    proximo = 0
    ultimo_f = max(max(c["frame"] for c in pend) + meia, max(recortes_em))
    leitor = LeitorVideo(video, area=area)
    idx = -1
    ultimo_emit = 0.0
    while idx < ultimo_f:
        idx += 1
        while proximo < len(pend) and pend[proximo]["frame"] - meia <= idx:
            c = pend[proximo]
            proximo += 1
            tr: Track = c["_tr"]
            f0, f1 = c["frame"] - meia, c["frame"] + meia
            x1, y1, x2, y2, ow, oh = _regiao_clipe(tr, f0, f1, largura, altura, escala)
            w = imageio_ffmpeg.write_frames(
                str(dir_clipes / f"{c['id']}.mp4"), (ow, oh), fps=fps, codec="libx264",
                pix_fmt_in="bgr24", pix_fmt_out="yuv420p", macro_block_size=2,
                output_params=["-preset", "veryfast", "-crf", "28", "-movflags", "+faststart"])
            w.send(None)
            ativos.append({"c": c, "w": w, "fim": f1, "reg": (x1, y1, x2, y2, ow, oh), "tr": tr})
        if not ativos and idx not in recortes_em:
            if not leitor.pular():
                break
            continue
        frame = leitor.ler()
        if frame is None:
            break
        for tr, caixa in recortes_em.get(idx, ()):
            tr.recortes.append((idx, _recortar(frame, caixa, tr.grupo)))
        for a in list(ativos):
            x1, y1, x2, y2, ow, oh = a["reg"]
            img = frame[y1:y2, x1:x2].copy()
            sx, sy = ow / max(1, x2 - x1), oh / max(1, y2 - y1)
            img = cv2.resize(img, (ow, oh), interpolation=cv2.INTER_AREA)
            for pa, pb in segs:
                cv2.line(img, (int((pa[0] - x1) * sx), int((pa[1] - y1) * sy)),
                         (int((pb[0] - x1) * sx), int((pb[1] - y1) * sy)), (0, 220, 255), 2)
            cx = _caixa_em(a["tr"], idx)
            if cx is not None:
                cor = (0, 0, 255) if idx >= a["c"]["frame"] else (0, 255, 0)
                cv2.rectangle(img, (int((cx[0] - x1) * sx), int((cx[1] - y1) * sy)),
                              (int((cx[2] - x1) * sx), int((cx[3] - y1) * sy)), cor, 2)
            a["w"].send(np.ascontiguousarray(img))
            if idx == a["c"]["frame"]:
                # quadro do evento com caixa e linhas: contexto para o modelo de
                # visão (em que faixa o objeto está; à noite o recorte é pouco)
                gravar_jpg(saida / "contextos" / f"{a['c']['id']}.jpg", img)
            if idx >= a["fim"]:
                a["w"].close()
                ativos.remove(a)
        agora = time.time()
        if agora - ultimo_emit >= 1.0:
            ultimo_emit = agora
            emitir(tipo="progresso", etapa="clipes", p=min(idx / max(ultimo_f, 1), 1.0), frame=idx)
    for a in ativos:
        a["w"].close()
    leitor.fechar()
    for c in candidatos:
        salvar_filmstrip(c["_tr"], saida / "filmstrips" / f"{c['id']}.jpg")


# ----------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--saida", required=True, help="pasta dos candidatos (mídias + candidatos.json)")
    ap.add_argument("--trilhas", help="arquivo .json.gz das trajetórias (padrão: <saida>/../trilhas.json.gz)")
    ap.add_argument("--linhas", help="JSON com lista de linhas {id,nome,x1,y1,x2,y2} (0–1)")
    ap.add_argument("--etapa", choices=["tudo", "trilhas", "candidatos"], default="tudo",
                    help="trilhas = só detecção; candidatos = só refazer a partir das trilhas salvas")
    ap.add_argument("--inicio", type=float, default=0.0, help="segundo inicial (testes)")
    ap.add_argument("--fim", type=float, default=None, help="segundo final (testes)")
    ap.add_argument("--imgsz", type=int, default=None, help="resolução de inferência (padrão: pela altura do vídeo)")
    ap.add_argument("--area", help="área de análise x,y,w,h (0–1 do quadro); o resto do quadro é ignorado")
    args = ap.parse_args()

    saida = Path(args.saida)
    arq_trilhas = Path(args.trilhas) if args.trilhas else saida.parent / "trilhas.json.gz"
    linhas = json.loads(Path(args.linhas).read_text(encoding="utf-8")) if args.linhas else []
    info = info_video(args.video)
    fps = info["fps"]
    area = area_em_px(tuple(float(v) for v in args.area.split(",")) if args.area else None,
                      info["largura"], info["altura"])

    tracks = None
    if args.etapa == "candidatos":
        tracks, meta = carregar_trilhas(arq_trilhas)
        if meta.get("versao", 1) < TRILHAS_VERSAO:
            tracks = None  # detecção antiga (sem movimento): refaz tudo
        elif tuple(meta.get("area") or ()) != tuple(area or ()):
            tracks = None  # outra área de análise: a detecção é outra
        elif area and meta.get("mov_fino", 1) < MOV_FINO_VERSAO:
            tracks = None  # área detectada antes do carro justo: refaz
    if tracks is None:
        inicio_f = int(args.inicio * fps)
        fim_f = int(args.fim * fps) if args.fim is not None else None
        linhas_previa = linhas_no_quadro(linhas, {"area": area, "original": [info["largura"], info["altura"]]})
        tracks, escala, leitor = passo_deteccao(args.video, inicio_f, fim_f, args.imgsz, area=area,
                                                previa=saida.parent / "previa.jpg",
                                                linhas_previa=linhas_previa)
        tracks = emendar_tracks(tracks, fps, escala)
        meta = {"fps": fps, "largura": leitor.largura, "altura": leitor.altura,
                "fator": leitor.fator, "escala": escala, "versao": TRILHAS_VERSAO,
                "area": list(area) if area else None, "area_arg": args.area if area else None,
                "mov_fino": MOV_FINO_VERSAO,
                "original": [info["largura"], info["altura"]]}
        salvar_trilhas(arq_trilhas, tracks, meta)
        (arq_trilhas.parent / "trilhas_meta.json").write_text(json.dumps(meta), encoding="utf-8")
        salvar_pontos(arq_trilhas.parent / "pontos.json", tracks, meta)
        if args.etapa == "trilhas":
            emitir(tipo="fim", trilhas=len(tracks))
            return
    largura, altura, escala = meta["largura"], meta["altura"], meta["escala"]  # espaço do quadro processado
    meta.setdefault("original", [info["largura"], info["altura"]])
    linhas_q = linhas_no_quadro(linhas, meta)

    for sub in ("filmstrips", "contextos", "clipes"):
        (saida / sub).mkdir(parents=True, exist_ok=True)
    candidatos = gerar_candidatos(tracks, linhas_q, largura, altura, fps, escala, fino=bool(meta.get("area")))
    emitir(tipo="progresso", etapa="clipes", p=0, candidatos=len(candidatos))
    passo_midias(args.video, candidatos, linhas_q, saida, fps, largura, altura, escala,
                 area=tuple(meta["area"]) if meta.get("area") else None)

    campos = ("id", "track", "linha_id", "frame", "tempo_s", "direcao", "bbox",
              "classe_yolo", "conf_yolo", "alternativa", "origem", "n_obs")
    saida_json = []
    for c in candidatos:
        d = {k: c.get(k) for k in campos}
        d["bbox"] = caixa_no_original(c["bbox"], meta)  # px do vídeo original
        d["filmstrip"] = f"filmstrips/{c['id']}.jpg"
        d["clipe"] = f"clipes/{c['id']}.mp4"
        d["contexto"] = f"contextos/{c['id']}.jpg"
        saida_json.append(d)
    (saida / "candidatos.json").write_text(json.dumps(saida_json, ensure_ascii=False, indent=1), encoding="utf-8")
    emitir(tipo="fim", candidatos=len(saida_json))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # o app mostra a mensagem no job
        emitir(tipo="erro", mensagem=f"{type(e).__name__}: {e}")
        raise
