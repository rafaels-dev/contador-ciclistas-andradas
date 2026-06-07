"""
Anotação visual do frame — 4 categorias com cores distintas.

  Ciclistas    → verde
  Pedestres    → amarelo
  Automóveis   → laranja
  Motocicletas → azul-ciano
"""

from __future__ import annotations

import cv2
import numpy as np
import supervision as sv

from .detector import ResultadoFrame


def _make_annotators(cor: sv.Color):
    return (
        sv.BoxAnnotator(color=cor, thickness=2),
        sv.LabelAnnotator(color=cor, text_color=sv.Color.WHITE,
                          text_scale=0.55, text_thickness=1),
        sv.TraceAnnotator(color=cor, thickness=2, trace_length=25),
    )

_COR_CIC = sv.Color(r=30,  g=210, b=30)    # verde
_COR_PED = sv.Color(r=220, g=210, b=0)     # amarelo
_COR_AUT = sv.Color(r=255, g=120, b=0)     # laranja
_COR_MOT = sv.Color(r=0,   g=190, b=230)   # azul-ciano

_box_cic, _lbl_cic, _trc_cic = _make_annotators(_COR_CIC)
_box_ped, _lbl_ped, _trc_ped = _make_annotators(_COR_PED)
_box_aut, _lbl_aut, _trc_aut = _make_annotators(_COR_AUT)
_box_mot, _lbl_mot, _trc_mot = _make_annotators(_COR_MOT)


def anotar_frame(
    frame: np.ndarray,
    resultado: ResultadoFrame,
    linha_x: int,
    mostrar_rastros: bool = True,
) -> np.ndarray:
    """Retorna cópia anotada com bboxes, trilhas, linha de contagem e painel."""
    saida = frame.copy()

    # Flash vermelho ao cruzar a linha
    qualquer_novo = (resultado.novos_ciclistas + resultado.novos_pedestres
                     + resultado.novos_automoveis + resultado.novos_motocicletas)
    if qualquer_novo > 0:
        overlay = saida.copy()
        cv2.rectangle(overlay, (0, 0), (saida.shape[1], saida.shape[0]), (0, 0, 200), -1)
        cv2.addWeighted(overlay, 0.12, saida, 0.88, 0, saida)

    # Rastros de trajetória
    if mostrar_rastros:
        saida = _trc_cic.annotate(scene=saida, detections=resultado.ciclistas)
        saida = _trc_ped.annotate(scene=saida, detections=resultado.pedestres)
        saida = _trc_aut.annotate(scene=saida, detections=resultado.automoveis)
        saida = _trc_mot.annotate(scene=saida, detections=resultado.motocicletas)

    # Bounding boxes
    saida = _box_cic.annotate(scene=saida, detections=resultado.ciclistas)
    saida = _box_ped.annotate(scene=saida, detections=resultado.pedestres)
    saida = _box_aut.annotate(scene=saida, detections=resultado.automoveis)
    saida = _box_mot.annotate(scene=saida, detections=resultado.motocicletas)

    # Labels com prefixo de categoria e ID do tracker
    saida = _lbl_cic.annotate(scene=saida, detections=resultado.ciclistas,
                               labels=_ids(resultado.ciclistas, "C"))
    saida = _lbl_ped.annotate(scene=saida, detections=resultado.pedestres,
                               labels=_ids(resultado.pedestres, "P"))
    saida = _lbl_aut.annotate(scene=saida, detections=resultado.automoveis,
                               labels=_ids(resultado.automoveis, "A"))
    saida = _lbl_mot.annotate(scene=saida, detections=resultado.motocicletas,
                               labels=_ids(resultado.motocicletas, "M"))

    # Linha de contagem vertical
    h = saida.shape[0]
    cv2.line(saida, (linha_x, 0), (linha_x, h), (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(saida, "linha de contagem", (linha_x + 6, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

    _painel(saida, resultado)
    return saida


def _ids(det: sv.Detections, prefixo: str) -> list[str]:
    ids = det.tracker_id
    if ids is None or len(ids) == 0:
        return []
    return [f"{prefixo}#{tid}" for tid in ids]


def _painel(frame: np.ndarray, r: ResultadoFrame) -> None:
    """Painel semi-transparente no canto superior esquerdo com os 4 contadores."""
    pw, ph = 340, 210
    overlay = frame.copy()
    cv2.rectangle(overlay, (8, 8), (8 + pw, 8 + ph), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.68, frame, 0.32, 0, frame)

    fonte  = cv2.FONT_HERSHEY_DUPLEX
    branco = (240, 240, 240)
    cinza  = (150, 150, 150)

    cv2.putText(frame, "ANDRADAS  -  CONTAGEM DE VEICULOS", (16, 32), fonte, 0.42, branco, 1)
    cv2.line(frame, (16, 40), (8 + pw - 8, 40), (70, 70, 70), 1)

    # Legenda de cores
    _linha_painel(frame, y=70,  cor=(30, 210, 30),   label="Ciclistas",
                  total=r.total_ciclistas,    ent=r.cic_in, sai=r.cic_out)
    _linha_painel(frame, y=105, cor=(0, 210, 220),   label="Pedestres",
                  total=r.total_pedestres,    ent=r.ped_in, sai=r.ped_out)
    _linha_painel(frame, y=140, cor=(0, 120, 255),   label="Automoveis",
                  total=r.total_automoveis,   ent=r.aut_in, sai=r.aut_out)
    _linha_painel(frame, y=175, cor=(230, 120, 0),   label="Motos",
                  total=r.total_motocicletas, ent=r.mot_in, sai=r.mot_out)

    cv2.line(frame, (16, 188), (8 + pw - 8, 188), (70, 70, 70), 1)
    cv2.putText(frame, f"Total geral: {r.total_geral}", (16, 205),
                fonte, 0.50, branco, 1)


def _linha_painel(frame, y, cor, label, total, ent, sai):
    fonte = cv2.FONT_HERSHEY_DUPLEX
    # Quadrado colorido como legenda
    cv2.rectangle(frame, (16, y - 12), (28, y), cor, -1)
    cv2.putText(frame, label,     (35, y),       fonte, 0.50, cor,           1)
    cv2.putText(frame, str(total),(210, y),       fonte, 0.85, cor,           2)
    cv2.putText(frame, f"in {ent}  out {sai}",
                                  (255, y),       fonte, 0.37, (170, 170, 170), 1)
