"""Geometria do worker: cruzamento com a linha e conversões entre o quadro
processado (área de análise, reduzido) e o vídeo original."""
import pytest

from detectar import caixa_no_original, cruzamento, linhas_no_quadro, ponto_chao
from leitor import area_em_px

LINHA = ((10, 0), (10, 20))  # vertical, x = 10


def test_cruzamento_no_meio_do_movimento():
    assert cruzamento(*LINHA, (5, 10), (15, 10)) == pytest.approx(0.5)
    assert cruzamento(*LINHA, (8, 10), (18, 10)) == pytest.approx(0.2)


def test_sem_cruzamento_do_mesmo_lado():
    assert cruzamento(*LINHA, (1, 10), (9, 10)) is None


def test_sem_cruzamento_alem_da_ponta_do_segmento():
    # passa por x = 10, mas abaixo do fim da linha (y > 20)
    assert cruzamento(*LINHA, (5, 30), (15, 30)) is None


def test_sem_cruzamento_partindo_de_cima_da_linha():
    assert cruzamento(*LINHA, (10, 10), (15, 10)) is None


def test_ponto_chao_e_a_base_central_da_caixa():
    assert ponto_chao((10, 20, 30, 60)) == (20, 60)


class TestAreaEmPx:
    def test_sem_area_e_o_quadro_inteiro(self):
        assert area_em_px(None, 3840, 2160) is None

    def test_area_do_quadro_inteiro_vira_none(self):
        assert area_em_px((0, 0, 1, 1), 3840, 2160) is None

    def test_dimensoes_pares(self):
        # yuv420 exige largura, altura e origem pares
        x, y, w, h = area_em_px((0.3556, 0.4455, 0.2003, 0.2167), 3840, 2160)
        assert all(v % 2 == 0 for v in (x, y, w, h))
        assert (x, y) == (1364, 962)
        assert 765 <= w <= 770 and 466 <= h <= 469

    def test_area_que_passa_da_borda_e_cortada(self):
        x, y, w, h = area_em_px((0.8, 0.8, 0.5, 0.5), 1000, 1000)
        assert (x + w, y + h) == (1000, 1000)

    def test_area_pequena_demais_e_ignorada(self):
        assert area_em_px((0.5, 0.5, 0.01, 0.01), 1920, 1080) is None


class TestCoordenadasDaArea:
    META = {"area": [1000, 500, 800, 400], "original": [4000, 2000], "fator": 1.0}

    def test_linhas_sem_area_nao_mudam(self):
        linhas = [{"id": "l", "x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4}]
        assert linhas_no_quadro(linhas, {"area": None}) is linhas

    def test_linhas_passam_para_o_recorte(self):
        # (0.25, 0.25) do original = (1000, 500) px = canto do recorte
        # (0.45, 0.45) = (1800, 900) px = canto oposto
        [l] = linhas_no_quadro([{"id": "l", "nome": "L", "x1": 0.25, "y1": 0.25, "x2": 0.45, "y2": 0.45}], self.META)
        assert (l["x1"], l["y1"]) == pytest.approx((0, 0))
        assert (l["x2"], l["y2"]) == pytest.approx((1, 1))
        assert l["nome"] == "L"

    def test_caixa_volta_ao_original(self):
        assert caixa_no_original([10, 20, 30, 40], self.META) == [1010, 520, 1030, 540]

    def test_caixa_de_quadro_reduzido_volta_ao_original(self):
        # 4K processado em 1080p: fator 2, sem área
        assert caixa_no_original([10, 20, 30, 40], {"area": None, "fator": 2.0}) == [20, 40, 60, 80]
