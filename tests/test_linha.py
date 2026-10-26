"""LinhaContagem (contador/linha.py), usada pelos modos de linha de comando:
só conta quem cruza a linha, uma vez por objeto, inclusive quando o
ByteTrack troca o id em cima dela — e não conta quando a troca não é
fisicamente plausível."""
import numpy as np
import supervision as sv

from contador.linha import LinhaContagem

LINHA_X = 500


def quadro(*objetos) -> sv.Detections:
    """objetos: (tracker_id, cx, cy) com caixas de 40×80."""
    if not objetos:
        return sv.Detections.empty()
    xyxy = np.array([[cx - 20, cy - 40, cx + 20, cy + 40] for _, cx, cy in objetos], dtype=float)
    return sv.Detections(xyxy=xyxy, tracker_id=np.array([t for t, _, _ in objetos]))


def rodar(linha: LinhaContagem, quadros) -> LinhaContagem:
    for objetos in quadros:
        linha.trigger(quadro(*objetos))
    return linha


def andando(tid, x0, x1, n=10, cy=300):
    return [[(tid, x0 + (x1 - x0) * i / (n - 1), cy)] for i in range(n)]


def test_esquerda_para_direita_conta_out():
    l = rodar(LinhaContagem(LINHA_X), andando(1, 300, 700))
    assert (l.in_count, l.out_count) == (0, 1)
    assert l.eventos[0]["motivo"] == "centroide"


def test_direita_para_esquerda_conta_in():
    l = rodar(LinhaContagem(LINHA_X), andando(1, 700, 300))
    assert (l.in_count, l.out_count) == (1, 0)


def test_quem_nao_cruza_nao_conta():
    l = rodar(LinhaContagem(LINHA_X), andando(1, 100, 450))
    assert l.in_count + l.out_count == 0


def test_vai_e_volta_conta_uma_vez():
    l = rodar(LinhaContagem(LINHA_X), andando(1, 300, 700) + andando(1, 700, 300))
    assert l.in_count + l.out_count == 1


def test_mesmo_id_que_some_e_volta_do_outro_lado():
    quadros = andando(1, 300, 480, n=5) + [[]] * 3 + andando(1, 560, 700, n=5)
    l = rodar(LinhaContagem(LINHA_X), quadros)
    assert l.out_count == 1
    assert l.eventos[0]["motivo"] == "centroide_gap"


def test_id_novo_do_outro_lado_conta_uma_vez():
    # o track quebra na travessia: id 1 some à esquerda, id 2 surge à direita
    quadros = andando(1, 300, 480, n=10) + [[]] * 2 + andando(2, 540, 700, n=8)
    l = rodar(LinhaContagem(LINHA_X), quadros)
    assert l.out_count == 1
    assert l.eventos[0]["motivo"] == "reid_oposto"


def test_id_novo_contrario_a_velocidade_nao_e_o_mesmo_objeto():
    # id 1 ia para a ESQUERDA (afastando-se da linha) e some; um id novo do
    # outro lado não pode ser ele
    quadros = andando(1, 490, 400, n=10) + [[]] * 2 + andando(2, 520, 700, n=8)
    l = rodar(LinhaContagem(LINHA_X), quadros)
    assert l.in_count + l.out_count == 0


def test_id_novo_em_outra_faixa_nao_e_o_mesmo_objeto():
    quadros = andando(1, 300, 480, n=10) + [[]] * 2 + andando(2, 540, 700, n=8, cy=700)
    l = rodar(LinhaContagem(LINHA_X), quadros)
    assert l.in_count + l.out_count == 0


def test_id_novo_rapido_demais_nao_e_o_mesmo_objeto():
    quadros = andando(1, 300, 480, n=10) + [[]] * 2 + andando(2, 900, 1000, n=4)
    l = rodar(LinhaContagem(LINHA_X, vmax_reid=50), quadros)
    assert l.in_count + l.out_count == 0


def test_reid_do_mesmo_lado_herda_ja_contado():
    # cruzou (contado), sumiu por oclusão e voltou com id novo do mesmo lado
    quadros = andando(1, 300, 700, n=10) + [[]] * 3 + andando(2, 720, 300, n=10)
    l = rodar(LinhaContagem(LINHA_X), quadros)
    assert l.in_count + l.out_count == 1


def test_caixa_duplicada_colada_em_track_contado_nao_conta():
    quadros = andando(1, 300, 700, n=10)
    # depois da contagem, o YOLO dá uma segunda caixa ao mesmo objeto, com outro id;
    # o track 1 some e a caixa duplicada segue sozinha (e volta pela linha)
    quadros += [[(1, 700 + 10 * i, 300), (2, 690 + 10 * i, 310)] for i in range(1, 4)]
    quadros += andando(2, 720, 300, n=10)
    l = rodar(LinhaContagem(LINHA_X), quadros)
    assert l.in_count + l.out_count == 1


def test_objetos_diferentes_contam_separado():
    ida = andando(1, 300, 700)
    volta = andando(2, 700, 300, cy=600)
    l = rodar(LinhaContagem(LINHA_X), [a + b for a, b in zip(ida, volta)])
    assert (l.in_count, l.out_count) == (1, 1)


def test_entrada_pela_borda_so_no_modo_legado():
    entra = [[(1, 980 - 10 * i, 300)] for i in range(5)]  # aparece na borda direita e não cruza
    assert rodar(LinhaContagem(LINHA_X, frame_width=1000), entra).in_count == 0
    l = rodar(LinhaContagem(LINHA_X, frame_width=1000, contar_na_entrada=True), entra)
    assert l.in_count == 1 and l.eventos[0]["motivo"] == "entrada"
