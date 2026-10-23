#!/usr/bin/env python3
"""
Vídeo final do app de revisão: um ou mais vídeos em sequência, num único MP4,
com as linhas de contagem e um painel de contadores que SOMA entre os vídeos
(linhas com o mesmo nome são a mesma contagem).

Só entram os eventos confirmados na revisão humana — o app monta o plano a
partir de `candidatos.rotulo` (descartados ficam de fora). No quadro de cada
evento o contador sobe, a linha pisca na cor da categoria e o objeto ganha
uma caixa com o nome da categoria (trajetória das trilhas da detecção).

Uso:
  python worker/renderizar.py --plano plano.json --saida DIR [--fim S]
plano.json: {"videos": [{"titulo", "video", "trilhas", "linhas": [...],
             "eventos": [{"id", "frame", "linha_id", "categoria", "direcao", "track"}]}]}
Saída: DIR/video_final.mp4, DIR/relatorio.json, DIR/eventos.csv e, no stdout,
uma linha JSON por evento ({"tipo": "progresso"|"fim"|"erro"}).

Leitura sequencial (leitor.py), como na detecção: os frames dos eventos são
os mesmos índices que o detector gravou.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import queue
import subprocess
import sys

# os eventos JSON levam "→" e "…": no Windows o stdout nasce em cp1252
if (sys.stdout.encoding or "").lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from leitor import LeitorVideo, _ffmpeg  # noqa: E402

CATEGORIAS = ["ciclistas", "patinetes", "scooters", "monociclos", "pedestres", "automoveis", "motocicletas", "outros"]
NOME = {"ciclistas": "Ciclistas", "patinetes": "Patinetes", "scooters": "Scooters elétricos",
        "monociclos": "Monociclos", "pedestres": "Pedestres", "automoveis": "Automóveis",
        "motocicletas": "Motocicletas", "outros": "Outros"}
NOME_UM = {"ciclistas": "Ciclista", "patinetes": "Patinete", "scooters": "Scooter elétrico",
           "monociclos": "Monociclo", "pedestres": "Pedestre", "automoveis": "Automóvel",
           "motocicletas": "Motocicleta", "outros": "Outro"}
# RGB (PIL); o OpenCV recebe invertido. As mesmas cores de categoria do app
# (--color-cat-* em web/src/app/globals.css)
COR = {"ciclistas": (47, 191, 98), "patinetes": (23, 179, 163), "scooters": (139, 100, 240),
       "monociclos": (234, 79, 115), "pedestres": (61, 130, 240), "automoveis": (244, 123, 32),
       "motocicletas": (210, 75, 234), "outros": (160, 154, 147)}
COR_LINHA = (250, 204, 21)

ANTES_S, DEPOIS_S = 1.5, 1.0  # caixa do objeto em volta do evento
PISCA_S = 0.6                 # linha na cor da categoria depois do evento
LARGURA_SAIDA = 1920


def emitir(**dados) -> None:
    print(json.dumps(dados, ensure_ascii=False), flush=True)


def bgr(rgb) -> tuple[int, int, int]:
    return (rgb[2], rgb[1], rgb[0])


def fonte(tamanho: int, negrito: bool = False) -> ImageFont.ImageFont:
    nomes = (["DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf"] if negrito else ["DejaVuSans.ttf", "arial.ttf", "Arial.ttf"])
    pastas = ["/usr/share/fonts/truetype/dejavu", "C:/Windows/Fonts", "/Library/Fonts",
              "/System/Library/Fonts/Supplemental", ""]
    for n in nomes:
        for p in pastas:
            try:
                return ImageFont.truetype(str(Path(p) / n) if p else n, tamanho)
            except OSError:
                continue
    return ImageFont.load_default(tamanho)


class Rotulos:
    """Textos (com acentos — o Hershey do OpenCV não tem) em RGBA, cacheados."""

    def __init__(self, escala: float):
        self.f = fonte(int(22 * escala), negrito=True)
        self.cache: dict = {}

    def img(self, texto: str, cor) -> np.ndarray:
        k = (texto, cor)
        if k not in self.cache:
            l, t, r, b = self.f.getbbox(texto)
            im = Image.new("RGBA", (r - l + 12, b - t + 8), (*cor, 230))
            ImageDraw.Draw(im).text((6 - l, 4 - t), texto, font=self.f, fill=(255, 255, 255, 255))
            self.cache[k] = np.array(im)
        return self.cache[k]


def colar(frame: np.ndarray, rgba: np.ndarray, x: int, y: int) -> None:
    """Sobrepõe uma imagem RGBA em (x, y), recortando nas bordas."""
    h, w = rgba.shape[:2]
    H, W = frame.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return
    sub = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    a = sub[:, :, 3:4].astype(np.float32) / 255
    roi = frame[y0:y1, x0:x1]
    roi[:] = (roi * (1 - a) + sub[:, :, 2::-1] * a).astype(np.uint8)


class Painel:
    """Contadores por linha (somando os vídeos), redesenhado só quando muda."""

    def __init__(self, linhas_cats: dict[str, list[str]], escala: float):
        self.linhas_cats = linhas_cats
        self.e = escala
        self.f_tit = fonte(int(24 * escala), negrito=True)
        self.f_lin = fonte(int(21 * escala), negrito=True)
        self.f_cat = fonte(int(20 * escala))
        self.chave = None
        self.img: np.ndarray | None = None

    def desenhar(self, totais: dict, rodape: str, destaque: set) -> np.ndarray:
        chave = (json.dumps(totais, sort_keys=True), rodape, tuple(sorted(destaque)))
        if chave == self.chave:
            return self.img
        e = self.e
        pad, alt_cat, alt_lin = int(14 * e), int(28 * e), int(34 * e)
        largura = int(380 * e)
        altura = pad * 2 + int(36 * e) + int(28 * e)
        for cats in self.linhas_cats.values():
            altura += alt_lin + alt_cat * len(cats) + int(6 * e)
        im = Image.new("RGBA", (largura, altura), (15, 15, 20, 190))
        d = ImageDraw.Draw(im)
        y = pad
        d.text((pad, y), "Contagem", font=self.f_tit, fill=(255, 255, 255, 255))
        y += int(36 * e)
        for nome, cats in self.linhas_cats.items():
            d.text((pad, y), nome, font=self.f_lin, fill=(*COR_LINHA, 255))
            y += alt_lin
            for c in cats:
                n = totais.get(nome, {}).get(c, 0)
                acende = (nome, c) in destaque
                if acende:
                    d.rounded_rectangle((pad - 4, y - 2, largura - pad + 4, y + alt_cat - 4),
                                        radius=int(6 * e), fill=(*COR[c], 120))
                d.ellipse((pad, y + int(6 * e), pad + int(12 * e), y + int(18 * e)), fill=(*COR[c], 255))
                d.text((pad + int(22 * e), y), NOME[c], font=self.f_cat, fill=(235, 235, 235, 255))
                txt = str(n)
                w = d.textlength(txt, font=self.f_lin)
                d.text((largura - pad - w, y - 1), txt, font=self.f_lin, fill=(255, 255, 255, 255))
                y += alt_cat
            y += int(6 * e)
        d.text((pad, altura - pad - int(22 * e)), rodape, font=self.f_cat, fill=(170, 170, 170, 255))
        self.chave, self.img = chave, np.array(im)
        return self.img


class Codificador:
    """ffmpeg lendo BGR cru do stdin: NVENC se houver, senão libx264."""

    def __init__(self, destino: Path, largura: int, altura: int, fps: float):
        ff = _ffmpeg()
        entrada = ["-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{largura}x{altura}", "-r", f"{fps:.6f}", "-i", "-"]
        # teto de 2 Mbit/s: câmera de rua com árvores balançando estoura o
        # bitrate (cq 26 sem teto deu ~2,4 GB por vídeo de 2 h)
        nvenc = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "28", "-b:v", "1500k",
                 "-maxrate", "2M", "-bufsize", "4M"]
        x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M"]
        self.codec = "h264_nvenc" if self._funciona(ff, nvenc) else "libx264"
        cmd = [ff, "-hide_banner", "-loglevel", "error", "-y", *entrada,
               *(nvenc if self.codec == "h264_nvenc" else x264),
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destino)]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        # escrita no pipe numa thread (a escrita solta o GIL): desenhar o
        # próximo quadro e mandar o anterior ao ffmpeg acontecem juntos
        self.fila: queue.Queue = queue.Queue(maxsize=16)
        self.falha: BaseException | None = None
        self.thread = threading.Thread(target=self._escrever, daemon=True)
        self.thread.start()

    def _escrever(self) -> None:
        while (frame := self.fila.get()) is not None:
            if self.falha is None:
                try:
                    self.proc.stdin.write(memoryview(frame).cast("B"))
                except BaseException as e:  # ffmpeg morreu: o erro sai em fechar()
                    self.falha = e

    @staticmethod
    def _funciona(ff: str, params: list[str]) -> bool:
        teste = [ff, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2",
                 *params, "-f", "null", "-"]
        try:
            return subprocess.run(teste, capture_output=True, timeout=30).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def escrever(self, frame: np.ndarray) -> None:
        if self.falha is not None:
            raise RuntimeError(f"ffmpeg parou de aceitar quadros: {self.falha}")
        self.fila.put(np.ascontiguousarray(frame))

    def fechar(self) -> None:
        self.fila.put(None)
        self.thread.join()
        self.proc.stdin.close()
        erro = self.proc.stderr.read().decode(errors="replace")
        if self.proc.wait() != 0:
            raise RuntimeError(f"ffmpeg falhou: {erro.strip()[-500:]}")


def carregar_caixas(trilhas: str | None, tracks: set[str]) -> dict[str, dict[int, tuple]]:
    """track → {frame: caixa} (espaço do quadro processado), só dos tracks usados."""
    if not trilhas or not Path(trilhas).exists():
        return {}
    with gzip.open(trilhas, "rt", encoding="utf-8") as f:
        dados = json.load(f)
    out = {}
    for t in dados["tracks"]:
        chave = f"{t['grupo']}:{t['tid']}"
        if chave in tracks:
            out[chave] = dict(zip(t["frames"], (tuple(c) for c in t["caixas"])))
    return out


def quadros(leitor: LeitorVideo, limite: int | None):
    """Lê à frente numa thread (o ffmpeg/YUV→BGR soltam o GIL)."""
    fila: queue.Queue = queue.Queue(maxsize=16)

    def ler() -> None:
        n = 0
        while limite is None or n < limite:
            f = leitor.ler()
            if f is None:
                break
            fila.put(f)
            n += 1
        fila.put(None)

    threading.Thread(target=ler, daemon=True).start()
    while (f := fila.get()) is not None:
        yield f


def hms(s: float) -> str:
    s = int(round(s))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plano", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--fim", type=float, default=None, help="segundos por vídeo (testes)")
    args = ap.parse_args()
    plano = json.loads(Path(args.plano).read_text(encoding="utf-8"))
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    videos = plano["videos"]
    if not videos:
        raise ValueError("nenhum vídeo no plano")

    # linhas com o mesmo nome somam; categorias mostradas = as que a linha
    # conta (se configuradas) mais as que tiveram algum evento confirmado
    linhas_cats: dict[str, list[str]] = {}
    for v in videos:
        nomes = {l["id"]: l["nome"] for l in v["linhas"]}
        for l in v["linhas"]:
            cats = linhas_cats.setdefault(l["nome"], [])
            cats += [c for c in (l.get("categorias") or []) if c not in cats]
        for ev in v["eventos"]:
            nome = nomes.get(ev["linha_id"], "Sem linha")
            cats = linhas_cats.setdefault(nome, [])
            if ev["categoria"] not in cats:
                cats.append(ev["categoria"])
    # categorias escolhidas para este vídeo final (o runner já filtrou os
    # eventos; aqui some do painel o que o usuário deixou de fora)
    escolhidas = plano.get("categorias")
    if escolhidas:
        linhas_cats = {k: [c for c in cats if c in escolhidas] for k, cats in linhas_cats.items()}
    linhas_cats = {k: sorted(c, key=CATEGORIAS.index) for k, c in linhas_cats.items() if c}

    leitores = [LeitorVideo(v["video"]) for v in videos]
    for l in leitores:
        l.fechar()  # só o tamanho por enquanto; abre de novo na vez de cada vídeo
    largura = min(LARGURA_SAIDA, leitores[0].largura)
    altura = int(round(largura * leitores[0].altura / leitores[0].largura / 2)) * 2
    fps = float(leitores[0].info["fps"])
    escala = altura / 1080
    total_f = sum(min(l.info["frames"], int(args.fim * fps) if args.fim else 10**12) for l in leitores)

    destino = saida / "video_final.mp4"
    cod = Codificador(destino, largura, altura, fps)
    emitir(tipo="progresso", etapa="renderizando", p=0, codec=cod.codec)
    painel = Painel(linhas_cats, escala)
    rotulos = Rotulos(escala)
    totais: dict[str, dict[str, int]] = {}
    sentidos: dict[str, dict[str, dict[str, int]]] = {}
    linhas_rel = []
    resumo_videos = []
    feitos, t0, ultimo_emit, inicio_final = 0, time.time(), 0.0, 0.0

    for iv, v in enumerate(videos):
        leitor = LeitorVideo(v["video"])
        fv = float(leitor.info["fps"])
        # quadro processado → saída (mesmo aspecto: só escala; outro aspecto: faixas pretas)
        s = min(largura / leitor.largura, altura / leitor.altura)
        ox, oy = int((largura - leitor.largura * s) / 2), int((altura - leitor.altura * s) / 2)
        segs = [(l["nome"], (int(l["x1"] * leitor.largura * s + ox), int(l["y1"] * leitor.altura * s + oy)),
                 (int(l["x2"] * leitor.largura * s + ox), int(l["y2"] * leitor.altura * s + oy))) for l in v["linhas"]]
        nome_linha = {l["id"]: l["nome"] for l in v["linhas"]}
        eventos = sorted(v["eventos"], key=lambda e: e["frame"])
        caixas = carregar_caixas(v.get("trilhas"), {e["track"] for e in eventos if e.get("track")})
        antes, depois, pisca = int(ANTES_S * fv), int(DEPOIS_S * fv), int(PISCA_S * fv)
        por_frame: dict[int, list[dict]] = {}
        for e in eventos:
            por_frame.setdefault(e["frame"], []).append(e)
        limite = int(args.fim * fv) if args.fim else None
        rodape = f"Vídeo {iv + 1}/{len(videos)} · {v['titulo']}" if len(videos) > 1 else v["titulo"]
        cont_video: dict[str, dict[str, int]] = {}
        prox = 0
        idx = -1
        for frame in quadros(leitor, limite):
            idx += 1
            if s != 1.0 or ox or oy:
                quadro = np.zeros((altura, largura, 3), np.uint8)
                r = cv2.resize(frame, (int(leitor.largura * s), int(leitor.altura * s)), interpolation=cv2.INTER_AREA)
                quadro[oy:oy + r.shape[0], ox:ox + r.shape[1]] = r
                frame = quadro

            for e in por_frame.get(idx, ()):
                nome = nome_linha.get(e["linha_id"], "Sem linha")
                totais.setdefault(nome, {}).setdefault(e["categoria"], 0)
                totais[nome][e["categoria"]] += 1
                cont_video.setdefault(nome, {}).setdefault(e["categoria"], 0)
                cont_video[nome][e["categoria"]] += 1
                sentido = e.get("direcao") or "—"
                sc = sentidos.setdefault(nome, {}).setdefault(e["categoria"], {})
                sc[sentido] = sc.get(sentido, 0) + 1
                linhas_rel.append({"video": v["titulo"], "candidato": e["id"], "linha": nome,
                                   "categoria": e["categoria"], "sentido": sentido,
                                   "tempo_no_video_s": round(idx / fv, 2),
                                   "tempo_no_final_s": round(inicio_final + idx / fv, 2)})

            # eventos em volta deste quadro: caixa do objeto, linha piscando
            while prox < len(eventos) and eventos[prox]["frame"] + depois < idx:
                prox += 1
            ativos = [e for e in eventos[prox:] if e["frame"] - antes <= idx]
            piscando = {}
            destaque = set()
            for e in ativos:
                if 0 <= idx - e["frame"] <= pisca:
                    piscando[nome_linha.get(e["linha_id"])] = COR[e["categoria"]]
                    destaque.add((nome_linha.get(e["linha_id"], "Sem linha"), e["categoria"]))
            for nome, a, b in segs:
                cor = piscando.get(nome, COR_LINHA)
                cv2.line(frame, a, b, bgr(cor), max(2, int(4 * escala)) + (3 if nome in piscando else 0), cv2.LINE_AA)
            for e in ativos:
                cx = caixas.get(e.get("track"), {}).get(idx)
                if cx is None:
                    continue
                x1, y1, x2, y2 = (int(cx[0] * s + ox), int(cx[1] * s + oy), int(cx[2] * s + ox), int(cx[3] * s + oy))
                cor = COR[e["categoria"]]
                cv2.rectangle(frame, (x1, y1), (x2, y2), bgr(cor), max(2, int(3 * escala)))
                txt = NOME_UM[e["categoria"]] + (" +1" if idx >= e["frame"] else "")
                rot = rotulos.img(txt, cor)
                colar(frame, rot, x1, y1 - rot.shape[0] - 2)
            for nome, a, b in segs:
                rot = rotulos.img(nome, (120, 90, 0))
                colar(frame, rot, a[0] + 6, a[1] + 6)
            m = int(16 * escala)
            colar(frame, painel.desenhar(totais, rodape, destaque), m, m)
            cod.escrever(frame)
            feitos += 1

            agora = time.time()
            if agora - ultimo_emit >= 1.0:
                ultimo_emit = agora
                emitir(tipo="progresso", etapa="renderizando", p=min(feitos / max(total_f, 1), 1.0),
                       fps=round(feitos / (agora - t0), 1), video=iv + 1, videos=len(videos))
        leitor.fechar()
        dur = (idx + 1) / fv
        resumo_videos.append({"titulo": v["titulo"], "inicio_no_final_s": round(inicio_final, 2),
                              "duracao_s": round(dur, 2), "totais": cont_video})
        inicio_final += dur
    cod.fechar()

    relatorio = {"gerado_em": datetime.now().isoformat(timespec="seconds"), "codec": cod.codec,
                 "totais": totais, "por_sentido": sentidos, "videos": resumo_videos, "eventos": linhas_rel}
    (saida / "relatorio.json").write_text(json.dumps(relatorio, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(saida / "eventos.csv", "w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel abre com acentos
        w = csv.writer(f, delimiter=";")
        w.writerow(["video", "tempo_no_video", "tempo_no_video_final", "linha", "categoria", "sentido", "candidato"])
        for r in linhas_rel:
            w.writerow([r["video"], hms(r["tempo_no_video_s"]), hms(r["tempo_no_final_s"]), r["linha"],
                        NOME_UM[r["categoria"]], r["sentido"], r["candidato"]])
    emitir(tipo="fim", eventos=len(linhas_rel), duracao_s=round(inicio_final, 1), codec=cod.codec)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # o app mostra a mensagem
        emitir(tipo="erro", mensagem=f"{type(e).__name__}: {e}")
        raise
