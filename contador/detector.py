"""
Núcleo do contador — 4 categorias independentes.

Uma única inferência YOLO por frame detecta todas as classes (NMS
class-agnostic: evita caixa dupla car+truck do mesmo veículo).

CICLISTAS são contados pela própria classe `bicycle` (tracker + linha
dedicados, como motos/automóveis) — decisão de projeto: raramente passam
veículos com bicicletas penduradas, então toda bicycle que cruza é um
ciclista.

PESSOAS são rastreadas em um único tracker e o track acumula, frame a
frame, quantas vezes teve uma bicycle (assoc bike) ou motorcycle (assoc
moto) próxima (≤ dist_max px). Ao cruzar a linha, a pessoa conta como
PEDESTRE somente se o track NÃO estiver associado a bike (é o ciclista,
já contado pela bicycle) nem a moto (garupa/piloto, já contado pela
moto). Classificação por track (não por frame) evita dupla contagem por
"flicker" de detecção da bicicleta.

Automóveis (car+bus+truck) e motocicletas mantêm trackers e linhas
próprios. LinhaContagem usa centróide + re-ID (ver linha.py).
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


class _Contagem:
    """Contador simples por categoria (mesma interface de LinhaContagem
    para in_count/out_count/eventos)."""

    def __init__(self):
        self.in_count = 0
        self.out_count = 0
        self.eventos: list[dict] = []

    def registrar(self, lado: str, evento: dict) -> None:
        if lado == "esq":
            self.in_count += 1
        else:
            self.out_count += 1
        self.eventos.append(evento)


class _ContagemCombinada:
    """Visão somada de dois contadores (ex.: bicycles + ciclistas-fallback)."""

    def __init__(self, *partes):
        self._partes = partes

    @property
    def in_count(self):
        return sum(p.in_count for p in self._partes)

    @property
    def out_count(self):
        return sum(p.out_count for p in self._partes)

    @property
    def eventos(self):
        evs = [e for p in self._partes for e in p.eventos]
        evs.sort(key=lambda e: e.get("frame", 0))
        return evs


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

    Uso:
        contador = ContadorVeiculos()
        resultado = contador.processar(frame)
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
        imgsz: int = getattr(config, "IMGSZ", 640),
        modelo_bicicletas: str | None = getattr(
            config, "MODELO_BICICLETAS", None),
    ):
        self._confianca  = confianca
        self._iou        = iou
        self._imgsz      = imgsz
        self._roi_y      = (roi_y_min, roi_y_max)
        self._linha_x_config = linha_x
        self._linha_y    = (linha_y_inicio, linha_y_fim)
        self._dist_max   = dist_max_cyclist_px

        self._model = YOLO(modelo)
        # Modelo dedicado para bicicletas (fine-tuned com blur sintético
        # desta câmera): substitui SOMENTE as detecções da classe bicycle;
        # as demais classes continuam vindo do modelo principal.
        self._model_bic = YOLO(modelo_bicicletas) if modelo_bicicletas else None

        # Trackers: bicicletas, pessoas, autos, motos
        self._tracker_bic = sv.ByteTrack()
        self._tracker_pes = sv.ByteTrack()
        self._tracker_aut = sv.ByteTrack()
        self._tracker_mot = sv.ByteTrack()

        # Associação por track de pessoa: tid → {bike, moto, n, ultimo_frame}
        self._assoc: dict[int, dict] = {}
        self._frame_atual = 0

        # Linhas criadas no primeiro frame (dependem da largura)
        self._linha_bic: Optional[LinhaContagem] = None
        self._linha_pes: Optional[LinhaContagem] = None
        self._linha_aut: Optional[LinhaContagem] = None
        self._linha_mot: Optional[LinhaContagem] = None
        self._eventos_pes_vistos = 0

        # Contadores finais: pedestres e ciclistas-fallback (pessoa veloz
        # sem bicycle detectada — complementa a contagem por bicycle)
        self._cont_ped = _Contagem()
        self._cont_cic_extra = _Contagem()
        # frames de eventos de bicycle ainda não "reivindicados" por uma
        # pessoa associada a bike (pareamento 1:1 no cruzamento híbrido)
        self._bic_livres: list[int] = []
        self._eventos_bic_vistos = 0
        self._bic_tids_contados: set[int] = set()
        # eventos de pessoa-com-bike aguardando um evento de bicycle que
        # pode chegar até 45 frames depois (senão contam como ciclista)
        self._pes_bike_pendentes: list[dict] = []

        # Motos passam por arbitragem contra tracks de bicicleta (as classes
        # bicycle/motorcycle competem em veículos de 2 rodas)
        self._cont_mot = _Contagem()
        self._eventos_mot_vistos = 0
        # histórico de tracks de bicicleta: tid → {n, cx, cy, f}
        self._hist_bic: dict[int, dict] = {}

    # ------------------------------------------------------------------
    # API pública
    # ------------------------------------------------------------------

    def processar(self, frame: np.ndarray) -> ResultadoFrame:
        self._garantir_linhas(frame.shape[1])
        self._frame_atual += 1

        # 1. Detecção única para todas as classes
        results = self._model(
            frame,
            conf=self._confianca,
            iou=self._iou,
            imgsz=self._imgsz,
            classes=_CLASSES_TODAS,
            agnostic_nms=True,
            verbose=False,
        )[0]
        tudo = sv.Detections.from_ultralytics(results)
        tudo = self._filtrar_roi(tudo)

        pessoas_raw = self._extrair_por_classe(tudo, [_PERSON])
        if self._model_bic is not None:
            r_bic = self._model_bic(
                frame, conf=self._confianca, iou=self._iou,
                imgsz=self._imgsz, classes=[_BICYCLE], verbose=False)[0]
            bikes_raw = self._filtrar_roi(sv.Detections.from_ultralytics(r_bic))
        else:
            bikes_raw = self._extrair_por_classe(tudo, [_BICYCLE])
        autos_raw   = self._extrair_por_classe(tudo, config.CLASSES_AUTOMOVEIS)
        motos_raw   = self._extrair_por_classe(tudo, config.CLASSES_MOTOCICLETAS)

        # 2. Rastreamento
        bicicletas = self._tracker_bic.update_with_detections(bikes_raw)
        pessoas    = self._tracker_pes.update_with_detections(pessoas_raw)
        automoveis = self._tracker_aut.update_with_detections(autos_raw)
        motos      = self._tracker_mot.update_with_detections(motos_raw)

        # 3. Associação pessoa ↔ bicicleta/moto (por track)
        self._atualizar_assoc(pessoas, bikes_raw, motos_raw)

        # 3b. Histórico de tracks de bicicleta (para arbitragem com motos
        #     e para a contagem "pela tela")
        if len(bicicletas) and bicicletas.tracker_id is not None:
            bcx = (bicicletas.xyxy[:, 0] + bicicletas.xyxy[:, 2]) / 2
            bcy = (bicicletas.xyxy[:, 1] + bicicletas.xyxy[:, 3]) / 2
            for k, btid in enumerate(bicicletas.tracker_id):
                h = self._hist_bic.setdefault(
                    int(btid), {"n": 0, "cx0": float(bcx[k])})
                h["n"] += 1
                h["cx"] = float(bcx[k])
                h["cy"] = float(bcy[k])
                h["f"] = self._frame_atual

        # 4. Contagem por cruzamento de linha
        bic_in, bic_out = self._linha_bic.trigger(detections=bicicletas)
        pes_in, pes_out = self._linha_pes.trigger(detections=pessoas)
        aut_in, aut_out = self._linha_aut.trigger(detections=automoveis)
        mot_in, mot_out = self._linha_mot.trigger(detections=motos)

        # 4b. Arbitragem moto×bicicleta: um evento de moto colado num track
        #     de bicicleta recente e consistente é uma bicicleta mal
        #     classificada — não conta como moto.
        novos_mot = 0
        evs_mot = self._linha_mot.eventos
        while self._eventos_mot_vistos < len(evs_mot):
            ev = dict(evs_mot[self._eventos_mot_vistos])
            self._eventos_mot_vistos += 1
            pos = None
            if len(motos) and motos.tracker_id is not None:
                hit = np.where(motos.tracker_id == ev["tid"])[0]
                if len(hit):
                    pos = (float((motos.xyxy[hit[0], 0] + motos.xyxy[hit[0], 2]) / 2),
                           float((motos.xyxy[hit[0], 1] + motos.xyxy[hit[0], 3]) / 2))
            e_bike = False
            if pos is not None:
                for h in self._hist_bic.values():
                    if (h.get("n", 0) >= 3
                            and self._frame_atual - h.get("f", -999) <= 30
                            and abs(pos[0] - h.get("cx", 1e9)) <= 150
                            and abs(pos[1] - h.get("cy", 1e9)) <= 150):
                        e_bike = True
                        break
            if not e_bike:
                self._cont_mot.registrar(ev["lado"], ev)
                novos_mot += 1

        # limpeza do histórico de bikes
        if self._frame_atual % 500 == 0:
            limite = self._frame_atual - 600
            for t in [t for t, h in self._hist_bic.items()
                      if h.get("f", 0) < limite]:
                del self._hist_bic[t]

        # 4c. Eventos novos de bicycle: primeiro tentam quitar uma pessoa
        #     pendente (pareamento 1:1); sobras ficam "livres" p/ pareamento
        novos_cic_extra = 0
        evs_bic = self._linha_bic.eventos
        while self._eventos_bic_vistos < len(evs_bic):
            ev_b = evs_bic[self._eventos_bic_vistos]
            fb = ev_b.get("frame", self._frame_atual)
            self._bic_tids_contados.add(ev_b.get("tid", -1))
            self._eventos_bic_vistos += 1
            quitou = None
            for k, pend in enumerate(self._pes_bike_pendentes):
                if abs(pend.get("frame", 0) - fb) <= 45:
                    quitou = k
                    break
            if quitou is not None:
                self._pes_bike_pendentes.pop(quitou)
            else:
                self._bic_livres.append(fb)
        # expira bicycles livres muito antigas
        self._bic_livres = [f for f in self._bic_livres
                            if self._frame_atual - f <= 90]
        # 4d. Contagem "pela tela": track de bicycle que morreu há 45 frames
        #     SEM cruzar a linha, mas com deslocamento horizontal grande —
        #     um ciclista que entrou/saiu no meio do quadro (detecção tardia,
        #     conversão). Cristiano conta bicicletas que passam pela tela,
        #     não apenas as que cruzam a linha central.
        for btid, h in list(self._hist_bic.items()):
            # decide aos 29 frames pós-morte: _contados da linha ainda não
            # foi podado (poda ocorre após 30) e a janela de re-ID mesmo
            # lado (30) está praticamente encerrada
            if h.get("_decidido") or self._frame_atual - h.get("f", 0) != 29:
                continue
            h["_decidido"] = True
            if (btid in self._linha_bic._contados
                    or btid in self._bic_tids_contados or h["n"] < 4):
                continue
            # não conta se houve QUALQUER evento de bicycle a ≤60 frames —
            # cobre o tid parceiro consumido por reid_oposto/mesclagem, que
            # sai de _contados sem gerar evento próprio
            if any(abs(ev_b.get("frame", -999) - h["f"]) <= 60
                   for ev_b in self._linha_bic.eventos[-8:]):
                continue
            desloc = h["cx"] - h.get("cx0", h["cx"])
            if abs(desloc) < 350:
                continue
            ev_tela = {"frame": h["f"], "tid": int(btid),
                       "lado": "esq" if desloc < 0 else "dir",
                       "motivo": "tela", "dx": round(desloc / max(h["n"], 1), 1)}
            # absorve uma pessoa-com-bike pendente/futura (evita duplicar)
            quitou = None
            for k, pend in enumerate(self._pes_bike_pendentes):
                if abs(pend.get("frame", 0) - h["f"]) <= 90:
                    quitou = k
                    break
            if quitou is not None:
                self._pes_bike_pendentes.pop(quitou)
            self._bic_livres.append(h["f"])
            self._bic_tids_contados.add(int(btid))
            self._linha_bic._contados.add(int(btid))
            self._cont_cic_extra.registrar(ev_tela["lado"], ev_tela)
            novos_cic_extra += 1

        # pendências vencidas sem bicycle → conta como ciclista (pela pessoa)
        vencidas = [p for p in self._pes_bike_pendentes
                    if p["_prazo"] <= self._frame_atual]
        for p in vencidas:
            self._pes_bike_pendentes.remove(p)
            p.pop("_prazo", None)
            self._cont_cic_extra.registrar(p["lado"], p)
            novos_cic_extra += 1

        # 5. Pessoas cruzando: pedestre, ou ciclista-fallback (rápida,
        #    sem bicycle detectada — típico do motion blur noturno)
        novos_ped = 0
        limiar_vel = getattr(config, "LIMIAR_VEL_CICLISTA_PX_FRAME", None)
        evs = self._linha_pes.eventos
        while self._eventos_pes_vistos < len(evs):
            ev = dict(evs[self._eventos_pes_vistos])
            self._eventos_pes_vistos += 1
            a = self._assoc.get(ev["tid"], {"bike": 0, "moto": 0, "n": 1})
            n = max(a["n"], 1)
            assoc_bike = a["bike"] / n >= 0.3 or (a["bike"] >= 2 and n <= 10)
            assoc_moto = a["moto"] >= 2 and a["moto"] / n >= 0.5
            if assoc_moto:
                continue   # garupa/piloto — já contado pela moto
            if assoc_bike:
                # ciclista: já contado pela bicycle? Pareia com um evento de
                # bicycle não reivindicado numa janela de ±45 frames; se não
                # houver, a bicycle piscou na detecção e não formou track que
                # cruzasse — conta o ciclista pela pessoa.
                f_ev = ev.get("frame", self._frame_atual)
                par = None
                for k, fb in enumerate(self._bic_livres):
                    if abs(fb - f_ev) <= 45:
                        par = k
                        break
                if par is not None:
                    self._bic_livres.pop(par)
                else:
                    # aguarda uma bicycle cruzar nos próximos 45 frames
                    ev["classe_track"] = f"cic_pessoa {a['bike']}b/{n}"
                    ev["_prazo"] = f_ev + 45
                    self._pes_bike_pendentes.append(ev)
                continue
            vel = (abs(a.get("cx", 0.0) - a.get("cx0", 0.0))
                   / max(a.get("f", 1) - a.get("f0", 0), 1))
            if limiar_vel is not None and a["n"] >= 4 and vel >= limiar_vel:
                ev["classe_track"] = f"cic_veloz vel={vel:.0f}px/f n={a['n']}"
                self._cont_cic_extra.registrar(ev["lado"], ev)
                novos_cic_extra += 1
            else:
                ev["classe_track"] = f"ped {a['bike']}b/{a['moto']}m/{n}"
                self._cont_ped.registrar(ev["lado"], ev)
                novos_ped += 1

        # 6. Split visual de pessoas (pedestres para anotação)
        _, det_ped = self._split_visual(pessoas)

        return ResultadoFrame(
            ciclistas=bicicletas,
            pedestres=det_ped,
            automoveis=automoveis,
            motocicletas=motos,
            total_ciclistas=(self._linha_bic.in_count + self._linha_bic.out_count
                             + self._cont_cic_extra.in_count
                             + self._cont_cic_extra.out_count),
            total_pedestres=self._cont_ped.in_count + self._cont_ped.out_count,
            total_automoveis=self._linha_aut.in_count + self._linha_aut.out_count,
            total_motocicletas=self._cont_mot.in_count + self._cont_mot.out_count,
            cic_in=self._linha_bic.in_count + self._cont_cic_extra.in_count,
            cic_out=self._linha_bic.out_count + self._cont_cic_extra.out_count,
            ped_in=self._cont_ped.in_count, ped_out=self._cont_ped.out_count,
            aut_in=self._linha_aut.in_count, aut_out=self._linha_aut.out_count,
            mot_in=self._cont_mot.in_count, mot_out=self._cont_mot.out_count,
            novos_ciclistas=int(bic_in.sum()) + int(bic_out.sum()) + novos_cic_extra,
            novos_pedestres=novos_ped,
            novos_automoveis=int(aut_in.sum()) + int(aut_out.sum()),
            novos_motocicletas=novos_mot,
        )

    def resetar(self) -> None:
        self._tracker_bic = sv.ByteTrack()
        self._tracker_pes = sv.ByteTrack()
        self._tracker_aut = sv.ByteTrack()
        self._tracker_mot = sv.ByteTrack()
        self._linha_bic = self._linha_pes = self._linha_aut = self._linha_mot = None
        self._assoc = {}
        self._eventos_pes_vistos = 0
        self._cont_ped = _Contagem()
        self._cont_cic_extra = _Contagem()
        self._cont_mot = _Contagem()
        self._bic_livres = []
        self._eventos_bic_vistos = 0
        self._bic_tids_contados = set()
        self._pes_bike_pendentes = []
        self._eventos_mot_vistos = 0
        self._hist_bic = {}

    @property
    def linhas(self) -> dict:
        """Contadores por categoria (in_count / out_count / eventos)."""
        return {
            "ciclistas":    _ContagemCombinada(self._linha_bic, self._cont_cic_extra),
            "pedestres":    self._cont_ped,
            "automoveis":   self._linha_aut,
            "motocicletas": self._cont_mot,
        }

    # ------------------------------------------------------------------
    # Internos
    # ------------------------------------------------------------------

    def _garantir_linhas(self, largura: int) -> None:
        if self._linha_pes is not None:
            return
        x = self._linha_x_config if self._linha_x_config is not None else largura // 2
        kw = dict(linha_x=x, frame_width=largura)
        self._linha_bic = LinhaContagem(**kw)
        self._linha_pes = LinhaContagem(**kw)
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

    def _atualizar_assoc(
        self,
        pessoas: sv.Detections,
        bikes: sv.Detections,
        motos: sv.Detections,
    ) -> None:
        """Acumula associação pessoa↔bike/moto por track de pessoa."""
        if len(pessoas) == 0 or pessoas.tracker_id is None:
            self._podar_assoc()
            return

        p_cx = (pessoas.xyxy[:, 0] + pessoas.xyxy[:, 2]) / 2
        p_cy = (pessoas.xyxy[:, 1] + pessoas.xyxy[:, 3]) / 2

        def _tem_proximo(det: sv.Detections, i: int) -> bool:
            # anisotrópico: condutor fica quase alinhado em x com o veículo,
            # mas o centro da pessoa fica bem acima do centro do veículo
            if len(det) == 0:
                return False
            cx = (det.xyxy[:, 0] + det.xyxy[:, 2]) / 2
            cy = (det.xyxy[:, 1] + det.xyxy[:, 3]) / 2
            return bool(((np.abs(p_cx[i] - cx) <= 120)
                         & (np.abs(p_cy[i] - cy) <= 250)).any())

        for i, tid in enumerate(pessoas.tracker_id):
            a = self._assoc.setdefault(
                int(tid), {"bike": 0, "moto": 0, "n": 0, "f": 0,
                           "cx0": float(p_cx[i]), "f0": self._frame_atual})
            a["n"] += 1
            a["f"] = self._frame_atual
            a["cx"] = float(p_cx[i])
            if _tem_proximo(bikes, i):
                a["bike"] += 1
            if _tem_proximo(motos, i):
                a["moto"] += 1

        self._podar_assoc()

    def _podar_assoc(self) -> None:
        """Remove associações de tracks mortos há muito tempo (memória)."""
        if self._frame_atual % 500 != 0:
            return
        limite = self._frame_atual - 600
        mortos = [t for t, a in self._assoc.items() if a["f"] < limite]
        for t in mortos:
            del self._assoc[t]

    def _split_visual(
        self, pessoas: sv.Detections
    ) -> tuple[sv.Detections, sv.Detections]:
        """Divide pessoas em ciclistas/pedestres pela associação acumulada
        (apenas para visualização)."""
        if len(pessoas) == 0 or pessoas.tracker_id is None:
            return sv.Detections.empty(), sv.Detections.empty()
        e_cic = np.zeros(len(pessoas), dtype=bool)
        for i, tid in enumerate(pessoas.tracker_id):
            a = self._assoc.get(int(tid))
            if a and a["n"] and (a["bike"] / a["n"] >= 0.3
                                 or (a["bike"] >= 2 and a["n"] <= 10)):
                e_cic[i] = True
        cic = pessoas[e_cic] if e_cic.any() else sv.Detections.empty()
        ped = pessoas[~e_cic] if (~e_cic).any() else sv.Detections.empty()
        return cic, ped
