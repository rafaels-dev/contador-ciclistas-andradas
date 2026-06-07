"""
Núcleo do contador — 4 categorias independentes.

Uma única inferência YOLO por frame detecta todas as classes.
O resultado é então particionado em:

  Ciclistas    → person COM bicycle a ≤ dist_max px
  Pedestres    → person SEM bicycle próxima
  Automóveis   → car + bus + truck
  Motocicletas → motorcycle

Cada categoria tem seu próprio ByteTrack (IDs independentes) e LinhaContagem (contagem).
LinhaContagem usa centróide em vez de sv.LineZone, que falha para objetos grandes
(bbox sobrepõe a linha) e veículos muito rápidos (bbox clippado na borda do frame).
"""

from __future__ import annotations

import time
import warnings
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import supervision as sv
from ultralytics import YOLO

warnings.filterwarnings("ignore", category=FutureWarning, module="supervision")

import config
from .linha import LinhaContagem

# Classes COCO
_PERSON     = 0
_BICYCLE    = 1
_CAR        = 2
_MOTORCYCLE = 3
_BUS        = 5
_TRUCK      = 7

_CLASSES_TODAS = sorted(
    set(config.CLASSES_CICLISTAS
        + config.CLASSES_PEDESTRES
        + config.CLASSES_AUTOMOVEIS
        + config.CLASSES_MOTOCICLETAS)
)


@dataclass
class ResultadoFrame:
    # Detecções por categoria (para bboxes na tela)
    ciclistas:    sv.Detections
    pedestres:    sv.Detections
    automoveis:   sv.Detections
    motocicletas: sv.Detections

    # Totais acumulados
    total_ciclistas:    int
    total_pedestres:    int
    total_automoveis:   int
    total_motocicletas: int

    # Direções acumuladas (in / out)
    cic_in: int;  cic_out: int
    ped_in: int;  ped_out: int
    aut_in: int;  aut_out: int
    mot_in: int;  mot_out: int

    # Novos contados neste frame (para flash de evento)
    novos_ciclistas:    int
    novos_pedestres:    int
    novos_automoveis:   int
    novos_motocicletas: int

    timestamp: float = field(default_factory=time.time)

    @property
    def total_geral(self) -> int:
        return (self.total_ciclistas + self.total_pedestres
                + self.total_automoveis + self.total_motocicletas)


class ContadorVeiculos:
    """
    Contador multi-categoria em tempo real para câmeras fixas.

    Uma única chamada YOLO por frame; quatro rastreadores e quatro
    LineZones independentes garantem contagens sem interferência.

    Uso:
        contador = ContadorVeiculos()
        resultado = contador.processar(frame)
        print(resultado.total_ciclistas, resultado.total_pedestres,
              resultado.total_automoveis, resultado.total_motocicletas)
    """

    def __init__(
        self,
        modelo: str = config.MODELO,
        confianca: float = config.CONFIANCA,
        iou: float = config.IOU,
        linha_x: Optional[int] = None,
        linha_y_inicio: int = config.LINHA_Y_INICIO,
        linha_y_fim:    int = config.LINHA_Y_FIM,
        roi_y_min: int = config.ROI_Y_MIN,
        roi_y_max: int = config.ROI_Y_MAX,
        dist_max_cyclist_px: int = config.DIST_MAX_CYCLIST_PX,
    ):
        self._confianca  = confianca
        self._iou        = iou
        self._roi_y      = (roi_y_min, roi_y_max)
        self._linha_x_config = linha_x
        self._linha_y    = (linha_y_inicio, linha_y_fim)
        self._dist_max   = dist_max_cyclist_px

        self._model = YOLO(modelo)

        # Quatro rastreadores independentes
        self._tracker_cic = sv.ByteTrack()
        self._tracker_ped = sv.ByteTrack()
        self._tracker_aut = sv.ByteTrack()
        self._tracker_mot = sv.ByteTrack()

        # LinhasContagem criadas no primeiro frame (dependem da largura)
        self._linha_cic: Optional[LinhaContagem] = None
        self._linha_ped: Optional[LinhaContagem] = None
        self._linha_aut: Optional[LinhaContagem] = None
        self._linha_mot: Optional[LinhaContagem] = None

    # ------------------------------------------------------------------
    # API pública
    # ------------------------------------------------------------------

    def processar(self, frame: np.ndarray) -> ResultadoFrame:
        self._garantir_linhas(frame.shape[1])

        # 1. Detecção única para todas as classes
        results = self._model(
            frame,
            conf=self._confianca,
            iou=self._iou,
            classes=_CLASSES_TODAS,
            verbose=False,
        )[0]
        tudo = sv.Detections.from_ultralytics(results)
        tudo = self._filtrar_roi(tudo)

        # 2. Separação por categoria
        ciclistas_raw, pedestres_raw = self._separar_pessoas(tudo)
        autos_raw = self._extrair_por_classe(tudo, config.CLASSES_AUTOMOVEIS)
        motos_raw = self._extrair_por_classe(tudo, config.CLASSES_MOTOCICLETAS)

        # 3. Rastreamento independente
        ciclistas  = self._tracker_cic.update_with_detections(ciclistas_raw)
        pedestres  = self._tracker_ped.update_with_detections(pedestres_raw)
        automoveis = self._tracker_aut.update_with_detections(autos_raw)
        motos      = self._tracker_mot.update_with_detections(motos_raw)

        # 4. Contagem por cruzamento de linha
        cic_in,  cic_out  = self._linha_cic.trigger(detections=ciclistas)
        ped_in,  ped_out  = self._linha_ped.trigger(detections=pedestres)
        aut_in,  aut_out  = self._linha_aut.trigger(detections=automoveis)
        mot_in,  mot_out  = self._linha_mot.trigger(detections=motos)

        return ResultadoFrame(
            ciclistas=ciclistas,
            pedestres=pedestres,
            automoveis=automoveis,
            motocicletas=motos,
            total_ciclistas=self._linha_cic.in_count + self._linha_cic.out_count,
            total_pedestres=self._linha_ped.in_count + self._linha_ped.out_count,
            total_automoveis=self._linha_aut.in_count + self._linha_aut.out_count,
            total_motocicletas=self._linha_mot.in_count + self._linha_mot.out_count,
            cic_in=self._linha_cic.in_count, cic_out=self._linha_cic.out_count,
            ped_in=self._linha_ped.in_count, ped_out=self._linha_ped.out_count,
            aut_in=self._linha_aut.in_count, aut_out=self._linha_aut.out_count,
            mot_in=self._linha_mot.in_count, mot_out=self._linha_mot.out_count,
            novos_ciclistas=int(cic_in.sum())   + int(cic_out.sum()),
            novos_pedestres=int(ped_in.sum())   + int(ped_out.sum()),
            novos_automoveis=int(aut_in.sum())  + int(aut_out.sum()),
            novos_motocicletas=int(mot_in.sum()) + int(mot_out.sum()),
        )

    def resetar(self) -> None:
        self._tracker_cic = sv.ByteTrack()
        self._tracker_ped = sv.ByteTrack()
        self._tracker_aut = sv.ByteTrack()
        self._tracker_mot = sv.ByteTrack()
        self._linha_cic = self._linha_ped = self._linha_aut = self._linha_mot = None

    @property
    def linhas(self) -> dict[str, LinhaContagem]:
        return {
            "ciclistas":    self._linha_cic,
            "pedestres":    self._linha_ped,
            "automoveis":   self._linha_aut,
            "motocicletas": self._linha_mot,
        }

    # ------------------------------------------------------------------
    # Internos
    # ------------------------------------------------------------------

    def _garantir_linhas(self, largura: int) -> None:
        if self._linha_cic is not None:
            return
        x = self._linha_x_config if self._linha_x_config is not None else largura // 2
        kw = dict(linha_x=x, frame_width=largura)
        self._linha_cic = LinhaContagem(**kw)
        self._linha_ped = LinhaContagem(**kw, contar_na_entrada=False)
        self._linha_aut = LinhaContagem(**kw)
        self._linha_mot = LinhaContagem(**kw)

    def _filtrar_roi(self, det: sv.Detections) -> sv.Detections:
        if len(det) == 0:
            return det
        cy = (det.xyxy[:, 1] + det.xyxy[:, 3]) / 2
        return det[(cy >= self._roi_y[0]) & (cy <= self._roi_y[1])]

    def _extrair_por_classe(self, det: sv.Detections, classes: list[int]) -> sv.Detections:
        if len(det) == 0 or det.class_id is None:
            return sv.Detections.empty()
        mask = np.isin(det.class_id, classes)
        return det[mask] if mask.any() else sv.Detections.empty()

    def _separar_pessoas(
        self, det: sv.Detections
    ) -> tuple[sv.Detections, sv.Detections]:
        """
        Divide detecções de 'person' em categorias mutuamente exclusivas:
          - ciclistas : persons com bicycle a ≤ dist_max px
          - pedestres : persons sem bicycle NEM motorcycle próxima
          - descartados: persons próximos de motorcycle (garupa/piloto) —
            já contados via contador de motocicletas, não viram pedestre
        Retorna (ciclistas, pedestres).
        """
        if len(det) == 0 or det.class_id is None:
            return sv.Detections.empty(), sv.Detections.empty()

        cx = (det.xyxy[:, 0] + det.xyxy[:, 2]) / 2
        cy = (det.xyxy[:, 1] + det.xyxy[:, 3]) / 2

        idx_pessoas = np.where(det.class_id == _PERSON)[0]
        idx_bikes   = np.where(det.class_id == _BICYCLE)[0]
        idx_motos   = np.where(det.class_id == _MOTORCYCLE)[0]

        if len(idx_pessoas) == 0:
            return sv.Detections.empty(), sv.Detections.empty()

        bike_cx = cx[idx_bikes] if len(idx_bikes) else None
        bike_cy = cy[idx_bikes] if len(idx_bikes) else None
        moto_cx = cx[idx_motos] if len(idx_motos) else None
        moto_cy = cy[idx_motos] if len(idx_motos) else None

        idx_cic, idx_ped = [], []
        for i in idx_pessoas:
            # Próximo de bicicleta → ciclista
            if bike_cx is not None:
                dists_bike = np.sqrt((cx[i] - bike_cx) ** 2 + (cy[i] - bike_cy) ** 2)
                if dists_bike.min() <= self._dist_max:
                    idx_cic.append(i)
                    continue

            # Próximo de moto → garupa/piloto (descarta, não é pedestre)
            if moto_cx is not None:
                dists_moto = np.sqrt((cx[i] - moto_cx) ** 2 + (cy[i] - moto_cy) ** 2)
                if dists_moto.min() <= self._dist_max:
                    continue   # ignora: já contado pelo tracker de motos

            # Sem veículo próximo → pedestre
            idx_ped.append(i)

        ciclistas = det[np.array(idx_cic)] if idx_cic else sv.Detections.empty()
        pedestres = det[np.array(idx_ped)] if idx_ped else sv.Detections.empty()
        return ciclistas, pedestres
