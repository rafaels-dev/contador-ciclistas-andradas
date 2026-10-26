"""
Contador de cruzamentos de linha vertical.

Filosofia (v2): SÓ conta quem efetivamente cruza a linha x = linha_x.
Quatro caminhos de contagem, mutuamente exclusivos por ID:

  1. "centroide"      — o track persiste e seu cx troca de lado da linha.
  2. "centroide_gap"  — o track some por alguns frames e o MESMO ID
                        reaparece do outro lado (ByteTrack re-associou
                        dentro do track_buffer). O cruzamento aconteceu
                        durante o gap.
  3. "reid_oposto"    — o track quebra na travessia e um ID NOVO surge do
                        lado oposto de um ID perdido há ≤ janela_reid
                        frames, com coerência vertical (mesma faixa).
                        Conta uma vez, herdando o histórico do perdido.
  4. "entrada"        — legado, desligado por padrão (contar_na_entrada).
                        Conta ao entrar pela borda; a direção é inferida
                        pela borda de entrada (borda direita → vai para a
                        esquerda = in), não pelo lado atual.

Re-ID mesmo lado (janela_mesmo_lado, dist_spatial): ID novo no MESMO lado
de um ID perdido recentemente e espacialmente próximo → oclusão parcial /
redetecção breve. Mescla sem contar; herda status de "já contado".

Idempotência
------------
  Cada ID contado entra em `_contados`; nenhum caminho conta o mesmo ID
  duas vezes (todos os caminhos verificam). IDs perdidos há mais de
  `janela_limpeza` frames são removidos de `_perdidos` e `_contados`
  (o ByteTrack do supervision não reutiliza IDs, então isso é apenas
  controle de memória para execução contínua).
"""

from __future__ import annotations

import numpy as np
import supervision as sv


class LinhaContagem:
    """
    Parâmetros
    ----------
    linha_x : int
        Posição horizontal da linha (pixels).
    frame_width : int
        Largura do frame em pixels (para a verificação de borda do modo
        legado "entrada"). Se 0, a verificação de borda é desativada.
    margem_borda : int
        Distância máxima da borda (pixels) para considerar objeto "entrando".
    janela_reid : int
        Janela (frames) para re-ID no lado oposto (tracks quebrados na travessia).
    janela_mesmo_lado : int
        Janela (frames) para re-ID no mesmo lado (oclusão parcial).
    dist_spatial : float
        Distância máxima em cx (pixels) para re-ID no mesmo lado.
    dist_vertical : float
        Distância máxima em cy (pixels) para qualquer re-ID (coerência de faixa).
    vmax_reid : float
        Velocidade horizontal máxima plausível (px/frame) usada no re-ID de
        lado oposto: o deslocamento implícito |cx_novo - cx_perdido| deve
        caber em vmax_reid × frames_de_gap.
    contar_na_entrada : bool
        Modo legado: conta objetos ao entrarem pela borda do frame,
        mesmo sem cruzar a linha. Desligado por padrão.
    """

    def __init__(
        self,
        linha_x: int,
        frame_width: int = 0,
        margem_borda: int = 80,
        janela_reid: int = 20,
        janela_mesmo_lado: int = 30,
        dist_spatial: float = 120.0,
        dist_vertical: float = 180.0,
        vmax_reid: float = 100.0,
        contar_na_entrada: bool = False,
    ):
        self.linha_x           = linha_x
        self.frame_width       = frame_width
        self.margem_borda      = margem_borda
        self.janela_reid       = janela_reid
        self.janela_mesmo_lado = janela_mesmo_lado
        self.dist_spatial      = dist_spatial
        self.dist_vertical     = dist_vertical
        self.vmax_reid         = vmax_reid
        self.contar_na_entrada = contar_na_entrada

        self.in_count  = 0   # direita → esquerda
        self.out_count = 0   # esquerda → direita

        # id → (lado, cx, cy, dx)  — dx = velocidade horizontal (px/frame, EMA)
        self._ativos: dict[int, tuple[str, float, float, float]] = {}

        # id → (último lado, frame em que sumiu, último cx, último cy, dx)
        self._perdidos: dict[int, tuple[str, int, float, float, float]] = {}

        # IDs já contados — evita dupla contagem por qualquer caminho
        self._contados: set[int] = set()

        self._frame: int = 0

        # Log de eventos de contagem (diagnóstico): dicts com
        # frame, tid, lado, motivo
        self.eventos: list[dict] = []

    # ------------------------------------------------------------------
    # API pública
    # ------------------------------------------------------------------

    def trigger(
        self, detections: sv.Detections
    ) -> tuple[np.ndarray, np.ndarray]:
        """Processa um frame. Retorna (cruzou_in, cruzou_out) bool arrays."""
        self._frame += 1
        n = len(detections)
        cruzou_in  = np.zeros(n, dtype=bool)
        cruzou_out = np.zeros(n, dtype=bool)

        ids_ativos: set[int] = set()

        if n > 0 and detections.tracker_id is not None:
            ids_ativos = set(detections.tracker_id.tolist())

            for j, tid in enumerate(detections.tracker_id):
                x1 = float(detections.xyxy[j, 0])
                x2 = float(detections.xyxy[j, 2])
                cx = (x1 + x2) / 2
                cy = float(detections.xyxy[j, 1] + detections.xyxy[j, 3]) / 2
                lado = "esq" if cx < self.linha_x else "dir"

                dx = 0.0
                if tid in self._ativos:
                    # ── Track contínuo: cruzamento de centróide ──────────
                    lado_ant, cx_ant, _, dx_ant = self._ativos[tid]
                    dx = 0.5 * dx_ant + 0.5 * (cx - cx_ant)
                    if lado != lado_ant and tid not in self._contados:
                        self._contar(tid, lado, j, cruzou_in, cruzou_out,
                                     motivo="centroide", dx=dx)

                elif tid in self._perdidos:
                    # ── MESMO ID retomado após gap ───────────────────────
                    lado_ant, _, _, _, dx_ant = self._perdidos.pop(tid)
                    dx = dx_ant
                    if lado != lado_ant and tid not in self._contados:
                        # cruzou a linha durante o gap
                        self._contar(tid, lado, j, cruzou_in, cruzou_out,
                                     motivo="centroide_gap", dx=dx)

                else:
                    # ── ID novo ──────────────────────────────────────────

                    # 0. Caixa duplicada: novo ID colado num track ATIVO já
                    #    contado (detecção dupla do mesmo objeto) → herda
                    #    contado, nunca conta.
                    if self._perto_de_ativo_contado(tid, cx, cy):
                        self._contados.add(tid)
                        self._ativos[tid] = (lado, cx, cy, dx)
                        continue

                    # 1. Re-ID mesmo lado (oclusão parcial, redetecção breve)
                    par_igual = self._par_mesmo_lado(lado, cx, cy)
                    if par_igual is not None:
                        self._mesclar(tid, par_igual)

                    else:
                        # 2. Re-ID lado oposto (track quebrado na travessia)
                        par_oposto = self._par_oposto_lado(lado, cx, cy)
                        if par_oposto is not None:
                            ja_contado = (tid in self._contados
                                          or par_oposto in self._contados)
                            del self._perdidos[par_oposto]
                            self._contados.discard(par_oposto)
                            if not ja_contado:
                                self._contar(tid, lado, j, cruzou_in, cruzou_out,
                                             motivo="reid_oposto")
                            else:
                                self._contados.add(tid)

                        # 3. Modo legado: conta ao entrar pela borda
                        elif (self.contar_na_entrada
                              and tid not in self._contados
                              and self._na_borda(x1, x2)):
                            # direção inferida pela borda de entrada:
                            # borda direita → movendo-se para a esquerda (in)
                            borda_dir = x2 >= self.frame_width - self.margem_borda
                            lado_destino = "esq" if borda_dir else "dir"
                            self._contar(tid, lado_destino, j,
                                         cruzou_in, cruzou_out, motivo="entrada")

                        # 4. Caso contrário: aguarda cruzamento de centróide

                self._ativos[tid] = (lado, cx, cy, dx)

        self._atualizar_perdidos(ids_ativos)
        return cruzou_in, cruzou_out

    # ------------------------------------------------------------------
    # Internos
    # ------------------------------------------------------------------

    def _na_borda(self, x1: float, x2: float) -> bool:
        """True se o bbox toca a borda esquerda ou direita do frame."""
        if self.frame_width == 0:
            return False
        return x1 <= self.margem_borda or x2 >= self.frame_width - self.margem_borda

    def _contar(
        self,
        tid: int,
        lado: str,
        j: int,
        cruzou_in: np.ndarray,
        cruzou_out: np.ndarray,
        motivo: str = "?",
        dx: float = 0.0,
    ) -> None:
        self._contados.add(tid)
        if lado == "esq":        # direita → esquerda
            self.in_count += 1
            cruzou_in[j] = True
        else:                    # esquerda → direita
            self.out_count += 1
            cruzou_out[j] = True
        self.eventos.append(
            {"frame": self._frame, "tid": int(tid), "lado": lado,
             "motivo": motivo, "dx": round(float(dx), 1)}
        )

    def _mesclar(self, tid_novo: int, par: int) -> None:
        """Mescla ID novo com ID perdido sem contar; herda status contado."""
        if par in self._contados:
            self._contados.add(tid_novo)
        del self._perdidos[par]
        self._contados.discard(par)

    def _perto_de_ativo_contado(self, tid: int, cx: float, cy: float) -> bool:
        """True se (cx, cy) está colado num track ativo já contado."""
        for tid_a, (_lado, acx, acy, _adx) in self._ativos.items():
            if tid_a == tid or tid_a not in self._contados:
                continue
            if abs(cx - acx) <= 80 and abs(cy - acy) <= 120:
                return True
        return False

    def _par_mesmo_lado(self, lado: str, cx: float, cy: float) -> int | None:
        """Re-ID: perdido no MESMO lado, próximo em cx e cy."""
        melhor_tid  = None
        melhor_dist = float("inf")
        for tid, (ult_lado, ult_frame, ult_cx, ult_cy, _dx) in self._perdidos.items():
            if ult_lado != lado:
                continue
            if self._frame - ult_frame > self.janela_mesmo_lado:
                continue
            if abs(cy - ult_cy) > self.dist_vertical:
                continue
            dist = abs(cx - ult_cx)
            if dist <= self.dist_spatial and dist < melhor_dist:
                melhor_dist = dist
                melhor_tid  = tid
        return melhor_tid

    def _par_oposto_lado(self, lado: str, cx: float, cy: float) -> int | None:
        """Re-ID: perdido no LADO OPOSTO (track quebrado na travessia).

        Exige plausibilidade física do "cruzamento invisível":
          - coerência vertical (mesma faixa de tráfego);
          - o deslocamento implícito cabe em vmax_reid px/frame de gap;
          - se o perdido tinha velocidade conhecida, o novo ponto está
            à frente dela (não atrás — isso seria outro objeto).
        """
        lado_oposto = "dir" if lado == "esq" else "esq"
        melhor_tid  = None
        melhor_dcy  = float("inf")
        for tid, (ult_lado, ult_frame, ult_cx, ult_cy, ult_dx) in self._perdidos.items():
            if ult_lado != lado_oposto:
                continue
            gap = self._frame - ult_frame
            if gap > self.janela_reid:
                continue
            dcy = abs(cy - ult_cy)
            if dcy > self.dist_vertical:
                continue
            desloc = cx - ult_cx
            if abs(desloc) > self.vmax_reid * max(gap, 1):
                continue
            if abs(ult_dx) >= 2.0 and desloc * ult_dx < 0:
                continue   # movia-se para o outro lado — não é o mesmo objeto
            if dcy < melhor_dcy:
                melhor_dcy = dcy
                melhor_tid = tid
        return melhor_tid

    def _atualizar_perdidos(self, ids_ativos: set[int]) -> None:
        """Move IDs ausentes de ativos→perdidos; expira perdidos antigos."""
        for tid in set(self._ativos.keys()) - ids_ativos:
            lado, cx, cy, dx = self._ativos.pop(tid)
            self._perdidos[tid] = (lado, self._frame, cx, cy, dx)

        janela_limpeza = max(self.janela_reid, self.janela_mesmo_lado)
        expirados = [
            tid for tid, (_, f, _cx, _cy, _dx) in self._perdidos.items()
            if self._frame - f > janela_limpeza
        ]
        for tid in expirados:
            del self._perdidos[tid]
            self._contados.discard(tid)
