"""Do conjunto de trilhas aos candidatos da revisão (gerar_candidatos), às
emendas de tracks partidos e à persistência das trilhas — tudo sem vídeo nem
modelo, com trajetórias montadas à mão num quadro de 1000×1000 a 10 fps."""
from collections import Counter

import pytest

from detectar import (MIN_OBS, Track, carregar_trilhas, emendar_tracks, gerar_candidatos,
                      salvar_trilhas)

FPS = 10.0
LADO = 1000
LINHA = {"id": "l1", "nome": "Linha 1", "x1": 0.5, "y1": 0.0, "x2": 0.5, "y2": 1.0}


def trilha(grupo, tid, xs, *, frame0=0, base=600, largura=60, altura=120, conf=0.8, **extra):
    """Track com o ponto de chão em (x, base), um quadro por posição."""
    caixas = [(x - largura / 2, base - altura, x + largura / 2, base) for x in xs]
    return Track(grupo, tid, frames=[frame0 + i for i in range(len(xs))], caixas=caixas,
                 conf_soma=conf * len(xs), **extra)


def gerar(*tracks, linhas=(LINHA,), fino=False, escala=1.0):
    return gerar_candidatos({t.chave: t for t in tracks}, list(linhas), LADO, LADO, FPS, escala, fino=fino)


def andando(x0, x1, n=10):
    return [x0 + (x1 - x0) * i / (n - 1) for i in range(n)]


class TestCruzamento:
    def test_carro_que_cruza_vira_um_candidato(self):
        [c] = gerar(trilha("aut", 1, andando(300, 700)))
        assert c["linha_id"] == "l1"
        assert c["classe_yolo"] == "automoveis"
        assert c["origem"] == "track"
        assert c["conf_yolo"] == pytest.approx(0.8)
        # x = 500 fica entre o 5º (477,8) e o 6º (522,2) ponto
        assert c["frame"] in (4, 5)
        assert c["tempo_s"] == pytest.approx(c["frame"] / FPS)

    def test_sentidos_opostos(self):
        [ida] = gerar(trilha("aut", 1, andando(300, 700)))
        [volta] = gerar(trilha("aut", 1, andando(700, 300)))
        assert {ida["direcao"], volta["direcao"]} == {"A→B", "B→A"}

    def test_quem_nao_cruza_nao_vira_candidato(self):
        assert gerar(trilha("aut", 1, andando(100, 450))) == []

    def test_track_curto_demais_e_ignorado(self):
        assert gerar(trilha("aut", 1, andando(300, 700, n=MIN_OBS - 1))) == []

    def test_um_candidato_por_track_e_linha(self):
        # vai e volta pela linha: conta só o primeiro cruzamento
        xs = andando(300, 700) + andando(700, 300)
        assert len(gerar(trilha("pes", 1, xs))) == 1

    def test_duas_linhas_dois_candidatos(self):
        outra = {**LINHA, "id": "l2", "x1": 0.6, "x2": 0.6}
        cands = gerar(trilha("aut", 1, andando(300, 700)), linhas=(LINHA, outra))
        assert sorted(c["linha_id"] for c in cands) == ["l1", "l2"]

    def test_sem_linhas_conta_quem_anda_o_suficiente(self):
        longe = trilha("pes", 1, andando(100, 400))   # 300 px > 12% da diagonal
        perto = trilha("pes", 2, andando(100, 200))   # 100 px
        [c] = gerar(longe, perto, linhas=())
        assert c["track"] == "pes:1" and c["linha_id"] is None and c["direcao"] is None


class TestPessoaComVeiculo:
    def ciclista(self, com_bicicleta: bool):
        pessoa = trilha("pes", 1, andando(300, 700), n_bike=10, vizinhos=Counter({"bic:7": 10}))
        bike = trilha("bic", 7, andando(300, 700))
        return gerar(pessoa, bike) if com_bicicleta else gerar(pessoa)

    def test_pessoa_na_bicicleta_sai_quando_a_bicicleta_cruzou(self):
        [c] = self.ciclista(com_bicicleta=True)
        assert c["track"] == "bic:7" and c["classe_yolo"] == "ciclistas"

    def test_sem_a_bicicleta_a_pessoa_fica_como_ciclista(self):
        [c] = self.ciclista(com_bicicleta=False)
        assert c["track"] == "pes:1"
        assert c["classe_yolo"] == "ciclistas"
        assert c["origem"] == "pessoa_com_bicicleta"

    def test_pedestre_sem_veiculo_continua_pedestre(self):
        [c] = gerar(trilha("pes", 1, andando(300, 700)))
        assert c["classe_yolo"] == "pedestres"

    def test_bicicleta_e_moto_no_mesmo_objeto_ficam_uma_so(self):
        bike = trilha("bic", 1, andando(300, 700, n=12))
        moto = trilha("mot", 2, andando(300, 700, n=8))
        [c] = gerar(bike, moto)
        assert c["track"] == "bic:1"          # o track mais longo
        assert c["alternativa"] == "motocicletas"

    def test_bicicleta_e_moto_distantes_sao_dois_objetos(self):
        bike = trilha("bic", 1, andando(300, 700))
        moto = trilha("mot", 2, andando(300, 700), frame0=100)
        assert len(gerar(bike, moto)) == 2


class TestMovimento:
    def test_mancha_que_anda_vira_candidato_outros(self):
        [c] = gerar(trilha("mov", 1, andando(300, 700), altura=40, conf=0))
        assert c["origem"] == "movimento" and c["classe_yolo"] == "outros"

    def test_mancha_rapida_demais_e_ruido(self):
        # 0,4 s < MOV_MIN_S
        assert gerar(trilha("mov", 1, andando(300, 700, n=5), altura=40)) == []

    def test_mancha_que_anda_pouco_para_o_tamanho_e_ruido(self):
        # andou 60 px com 120 px de altura (< 1,5 altura): folha balançando
        assert gerar(trilha("mov", 1, andando(470, 530), altura=120)) == []

    def test_mancha_que_coincide_com_o_yolo_e_o_mesmo_objeto(self):
        carro = trilha("aut", 1, andando(300, 700))
        mancha = trilha("mov", 2, andando(310, 710), altura=40)
        [c] = gerar(carro, mancha)
        assert c["track"] == "aut:1"

    def test_na_area_mancha_pequena_e_ruido(self):
        # 20×20 px: passa no filtro comum, não no fino (p90 da área < 1000 px²)
        mancha = trilha("mov", 1, andando(300, 700), largura=20, altura=20)
        assert len(gerar(mancha)) == 1
        assert gerar(mancha, fino=True) == []

    def test_na_area_mancha_que_anda_pouco_e_ruido(self):
        mancha = trilha("mov", 1, andando(450, 550), largura=40, altura=40)  # 100 px < 120
        assert len(gerar(mancha)) == 1
        assert gerar(mancha, fino=True) == []

    def test_na_area_limites_acompanham_a_escala(self):
        # recorte 4K em resolução cheia (escala 2): o mesmo objeto tem 2× os pixels
        mancha = trilha("mov", 1, andando(400, 600), largura=40, altura=40)  # 200 px, 1600 px²
        assert len(gerar(mancha, fino=True, escala=1.0)) == 1
        assert gerar(mancha, fino=True, escala=2.0) == []


class TestLinhaDeFaixa:
    """Linha curta que não conta automóveis (ciclovia): a base da caixa de um
    carro na pista ao lado invade a faixa e não pode virar candidato."""
    CICLOVIA = {"id": "cv", "x1": 0.5, "y1": 0.55, "x2": 0.5, "y2": 0.65, "categorias": ["ciclistas"]}

    def test_objeto_largo_demais_para_a_faixa_e_ignorado(self):
        carro = trilha("aut", 1, andando(200, 800), largura=400)
        assert gerar(carro, linhas=(self.CICLOVIA,)) == []

    def test_ciclista_na_faixa_continua(self):
        ciclista = trilha("bic", 1, andando(300, 700), largura=60)
        assert len(gerar(ciclista, linhas=(self.CICLOVIA,))) == 1

    def test_linha_que_conta_automoveis_aceita_objeto_largo(self):
        rua = {**self.CICLOVIA, "categorias": ["automoveis", "ciclistas"]}
        carro = trilha("aut", 1, andando(200, 800), largura=400)
        assert len(gerar(carro, linhas=(rua,))) == 1


class TestEmendas:
    def test_track_partido_na_linha_e_emendado(self):
        # o ByteTrack perde o carro por 5 quadros e o retoma com outro id
        a = trilha("aut", 1, andando(300, 480, n=10))            # 20 px/quadro, quadros 0–9
        b = trilha("aut", 2, andando(600, 780, n=10), frame0=15)  # continua no mesmo ritmo
        tracks = emendar_tracks({t.chave: t for t in (a, b)}, FPS, 1.0)
        assert list(tracks) == ["aut:1"]
        assert tracks["aut:1"].n == 20
        assert tracks["aut:1"].emendas == ["aut:1", "aut:2"]
        # o cruzamento de x = 500 caiu no buraco: só o track emendado o vê
        assert gerar(a, b) == []
        assert len(gerar(*tracks.values())) == 1

    def test_track_que_surge_longe_nao_e_emendado(self):
        a = trilha("aut", 1, andando(300, 480, n=10))
        b = trilha("aut", 2, andando(600, 780, n=10), frame0=15, base=100)  # outra faixa
        assert len(emendar_tracks({t.chave: t for t in (a, b)}, FPS, 1.0)) == 2

    def test_grupos_diferentes_nao_se_emendam(self):
        a = trilha("aut", 1, andando(300, 480, n=10))
        b = trilha("pes", 2, andando(600, 780, n=10), frame0=15)
        assert len(emendar_tracks({t.chave: t for t in (a, b)}, FPS, 1.0)) == 2

    def test_vizinhos_da_pessoa_seguem_a_emenda(self):
        a = trilha("bic", 1, andando(300, 480, n=10))
        b = trilha("bic", 2, andando(600, 780, n=10), frame0=15)
        pessoa = trilha("pes", 9, andando(300, 780, n=25), n_bike=25, vizinhos=Counter({"bic:2": 5}))
        tracks = emendar_tracks({t.chave: t for t in (a, b, pessoa)}, FPS, 1.0)
        assert tracks["pes:9"].vizinhos == Counter({"bic:1": 5})


def test_trilhas_salvas_voltam_iguais(tmp_path):
    tr = trilha("pes", 3, andando(300, 700), n_bike=4, vizinhos=Counter({"bic:1": 4}))
    tr.classes = Counter({0: 10})
    curta = trilha("aut", 4, andando(300, 700, n=MIN_OBS - 1))
    meta = {"fps": FPS, "versao": 2}
    arq = tmp_path / "trilhas.json.gz"
    salvar_trilhas(arq, {t.chave: t for t in (tr, curta)}, meta)
    tracks, meta_lida = carregar_trilhas(arq)
    assert meta_lida == meta
    assert list(tracks) == ["pes:3"]  # a curta demais não é guardada
    lida = tracks["pes:3"]
    assert lida.frames == tr.frames
    assert lida.caixas == [tuple(round(v, 1) for v in c) for c in tr.caixas]
    assert lida.classes == tr.classes and lida.vizinhos == tr.vizinhos and lida.n_bike == 4
    assert lida.associado() == "bic"
