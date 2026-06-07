"""
Contador de cruzamentos de linha vertical.

Dois caminhos de contagem (mutuamente exclusivos por ID):

  A. Entry detection — conta ao ENTRAR no frame
     Só se aplica quando o bbox do objeto toca a borda lateral do frame
     (margem_borda px). Isso distingue "objeto entrou no enquadramento"
     de "track do ByteTrack foi reaberto no meio do frame".
     → garante que track quebrado e reaberto no meio não conta de novo.

  B. Cruzamento de centróide — conta ao CRUZAR x = linha_x
     Para objetos que surgem no meio do frame (tracks reabertos) ou que
     foram detectados pela primeira vez já dentro do enquadramento.

Re-ID de tracks quebrados (antes de decidir entre A e B):

  1. Re-ID mesmo lado + proximidade espacial (janela_mesmo_lado, dist_spatial)
     ID novo no MESMO LADO de um ID perdido recentemente e próximo → oclusão
     parcial. Mescla sem contar; herda status de "já contado".

  2. Re-ID lado oposto (janela_reid)
     ID novo no LADO OPOSTO de um ID perdido recentemente → track quebrado
     exatamente na travessia (veículo rápido). Conta uma vez se o original
     ainda não tinha sido contado.

Idempotência
------------
  Cada ID é rastreado em `_contados`. Nenhum caminho conta o mesmo ID duas
  vezes. IDs expirados de `_perdidos` são removidos de `_contados` para
  liberar o número para reutilização futura pelo ByteTrack.
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
        Largura do frame em pixels. Necessário para a verificação de borda.
        Se 0, a verificação é desativada e tudo conta na entrada (legado).
    margem_borda : int
        Distância máxima da borda (pixels) para considerar objeto "entrando".
    janela_reid : int
        Janela (frames) para re-ID no lado oposto (veículos rápidos).
    janela_mesmo_lado : int
        Janela (frames) para re-ID no mesmo lado (oclusão parcial).
    dist_spatial : float
        Distância máxima em cx (pixels) para re-ID no mesmo lado.
    """

    def __init__(
        self,
        linha_x: int,
        frame_width: int = 0,
        margem_borda: int = 80,
        janela_reid: int = 20,
        janela_mesmo_lado: int = 3,
        dist_spatial: float = 80.0,
        contar_na_entrada: bool = True,
    ):
        self.linha_x           = linha_x
        self.frame_width       = frame_width
        self.margem_borda      = margem_borda
        self.janela_reid       = janela_reid
        self.janela_mesmo_lado = janela_mesmo_lado
        self.dist_spatial      = dist_spatial
        self.contar_na_entrada = contar_na_entrada

        self.in_count  = 0   # direita → esquerda
        self.out_count = 0   # esquerda → direita

        # id → (lado, último cx)
        self._ativos: dict[int, tuple[str, float]] = {}

        # id → (último lado, frame em que sumiu, último cx)
        self._perdidos: dict[int, tuple[str, int, float]] = {}

        # IDs já contados — evita dupla contagem por qualquer caminho
        self._contados: set[int] = set()

        self._frame: int = 0

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
                lado = "esq" if cx < self.linha_x else "dir"

                if tid not in self._ativos:
                    # ── Novo ID ───────────────────────────────────────────

                    # 1. Re-ID mesmo lado (oclusão parcial, redetecção breve)
                    par_igual = self._par_mesmo_lado(lado, cx, excluir=tid)
                    if par_igual is not None:
                        self._mesclar(tid, par_igual)

                    else:
                        # 2. Re-ID lado oposto (track quebrado na travessia)
                        par_oposto = self._par_oposto_lado(lado, excluir=tid)
                        if par_oposto is not None:
                            if par_oposto not in self._contados:
                                self._contar(tid, lado, j, cruzou_in, cruzou_out)
                                self._contados.add(par_oposto)
                            else:
                                self._contados.add(tid)
                            del self._perdidos[par_oposto]
                            self._contados.discard(par_oposto)

                        # 3. Entry detection — só na borda do frame e se habilitado
                        elif (tid not in self._contados
                              and self.contar_na_entrada
                              and self._na_borda(x1, x2)):
                            self._contar(tid, lado, j, cruzou_in, cruzou_out)

                        # 4. Aguarda cruzamento de centróide

                    self._ativos[tid] = (lado, cx)

                else:
                    # ── ID já rastreado: cruzamento de centróide ──────────
                    lado_ant, _ = self._ativos[tid]
                    if lado != lado_ant and tid not in self._contados:
                        self._contar(tid, lado, j, cruzou_in, cruzou_out)
                    self._ativos[tid] = (lado, cx)

        self._atualizar_perdidos(ids_ativos)
        return cruzou_in, cruzou_out

    # ------------------------------------------------------------------
    # Internos
    # ------------------------------------------------------------------

    def _na_borda(self, x1: float, x2: float) -> bool:
        """True se o bbox toca a borda esquerda ou direita do frame."""
        if self.frame_width == 0:
            return True   # largura desconhecida → assume entrada pela borda
        return x1 <= self.margem_borda or x2 >= self.frame_width - self.margem_borda

    def _contar(
        self,
        tid: int,
        lado: str,
        j: int,
        cruzou_in: np.ndarray,
        cruzou_out: np.ndarray,
    ) -> None:
        self._contados.add(tid)
        if lado == "esq":        # direita → esquerda
            self.in_count += 1
            cruzou_in[j] = True
        else:                    # esquerda → direita
            self.out_count += 1
            cruzou_out[j] = True

    def _mesclar(self, tid_novo: int, par: int) -> None:
        """Mescla ID novo com ID perdido sem contar; herda status contado."""
        if par in self._contados:
            self._contados.add(tid_novo)
        del self._perdidos[par]
        self._contados.discard(par)

    def _par_mesmo_lado(self, lado: str, cx: float, excluir: int = -1) -> int | None:
        """Re-ID: perdido no MESMO LADO e dentro da distância espacial."""
        melhor_tid  = None
        melhor_dist = float("inf")
        for tid, (ult_lado, ult_frame, ult_cx) in self._perdidos.items():
            if tid == excluir:
                continue
            if ult_lado != lado:
                continue
            if self._frame - ult_frame > self.janela_mesmo_lado:
                continue
            dist = abs(cx - ult_cx)
            if dist <= self.dist_spatial and dist < melhor_dist:
                melhor_dist = dist
                melhor_tid  = tid
        return melhor_tid

    def _par_oposto_lado(self, lado: str, excluir: int = -1) -> int | None:
        """Re-ID: perdido no LADO OPOSTO (track quebrado na travessia)."""
        lado_oposto = "dir" if lado == "esq" else "esq"
        for tid, (ult_lado, ult_frame, _cx) in self._perdidos.items():
            if tid == excluir:
                continue
            if (ult_lado == lado_oposto
                    and self._frame - ult_frame <= self.janela_reid):
                return tid
        return None

    def _atualizar_perdidos(self, ids_ativos: set[int]) -> None:
        """Move IDs ausentes de ativos→perdidos; expira perdidos antigos."""
        for tid in set(self._ativos.keys()) - ids_ativos:
            lado, cx = self._ativos.pop(tid)
            self._perdidos[tid] = (lado, self._frame, cx)

        expirados = [
            tid for tid, (_, f, _cx) in self._perdidos.items()
            if self._frame - f > self.janela_reid
        ]
        for tid in expirados:
            del self._perdidos[tid]
            self._contados.discard(tid)
