#!/usr/bin/env python3
"""
Consolida candidatos a "bicicleta não contada" de 3 fontes:

  A. blobs órfãos — movimento na coluna da linha (contador independente)
     sem NENHUM evento contado (qualquer categoria) a ±15 frames;
  B. pedestres noturnos rápidos — eventos de pedestre 17h-23h com
     |dx| ≥ 35 px/frame (ciclistas noturnos caem neste balde);
  C. detecções bicycle de baixa confiança (0.05-0.40) do modelo FT nas
     horas 17-23, agrupadas em janelas, sem evento de ciclista a ±45.

Dedupe entre fontes por janela de 4 s. Prioridade C > B > A; cap por hora.

Saída: avaliacao/mineracao/candidatos.json
       [{id, hora, frame, tempo_s, fonte, box (ou null), y}]
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
FPS = 14.874455802535433
HORAS = [f"{h:02d}" for h in range(5, 24)]
NOITE = {"17", "18", "19", "20", "21", "22", "23"}
CAP_POR_HORA = 45


def carregar_eventos(hora):
    p = RAIZ / f"varredura_dual/diag_{hora}/eventos.jsonl"
    return [json.loads(l) for l in open(p)]


def main():
    lowconf = json.loads((RAIZ / "mineracao/lowconf_bike.json").read_text())
    candidatos = []

    for hora in HORAS:
        evs = carregar_eventos(hora)
        frames_contados = sorted(e["frame_video"] for e in evs)
        frames_cic = sorted(e["frame_video"] for e in evs
                            if e["categoria"] == "ciclistas")

        def perto(f, lista, tol):
            import bisect
            i = bisect.bisect_left(lista, f - tol)
            return i < len(lista) and lista[i] <= f + tol

        cand_hora = []

        # C: low-conf bikes agrupadas em janelas de 4s
        if hora in lowconf:
            hits = sorted(lowconf[hora], key=lambda x: x["f"])
            janela = []
            for hcand in hits + [{"f": 10**9}]:
                if janela and hcand["f"] - janela[-1]["f"] > int(4 * FPS):
                    melhor = max(janela, key=lambda x: x["conf"])
                    if not perto(melhor["f"], frames_cic, int(3 * FPS)):
                        cand_hora.append({"frame": melhor["f"], "fonte": "C",
                                          "box": melhor["box"],
                                          "conf": melhor["conf"]})
                    janela = []
                if hcand["f"] < 10**9:
                    janela.append(hcand)

        # B: pedestres noturnos rápidos
        if hora in NOITE:
            for e in evs:
                if (e["categoria"] == "pedestres"
                        and abs(e.get("dx", 0)) >= 35):
                    cand_hora.append({"frame": e["frame_video"], "fonte": "B",
                                      "box": e.get("bbox"), "conf": None})

        # A: blobs órfãos
        pb = RAIZ / f"mineracao/blobs/blobs_{hora}.json"
        if pb.exists():
            for b in json.loads(pb.read_text()):
                f = b["frame"] + b["dur_frames"] // 2
                if not perto(f, frames_contados, 15):
                    cand_hora.append({"frame": f, "fonte": "A", "box": None,
                                      "conf": None, "y": b["y_centro"]})

        # dedupe por janela de 4 s, prioridade C > B > A; cap da fonte A
        # menor de dia (nossa contagem diurna já é ~90-100% — blobs órfãos
        # diurnos são majoritariamente sombras)
        prio = {"C": 0, "B": 1, "A": 2}
        cap_a = 25 if hora in NOITE else 8
        cand_hora.sort(key=lambda c: (prio[c["fonte"]], c["frame"]))
        aceitos, n_a = [], 0
        for c in cand_hora:
            if c["fonte"] == "A" and n_a >= cap_a:
                continue
            if all(abs(c["frame"] - a["frame"]) > int(4 * FPS) for a in aceitos):
                aceitos.append(c)
                if c["fonte"] == "A":
                    n_a += 1
        aceitos = aceitos[:CAP_POR_HORA]
        for c in aceitos:
            c["hora"] = hora
            c["tempo_s"] = round(c["frame"] / FPS, 1)
        candidatos.extend(aceitos)

    candidatos.sort(key=lambda c: (c["hora"], c["frame"]))
    for i, c in enumerate(candidatos):
        c["id"] = f"c{i:04d}"
    (RAIZ / "mineracao/candidatos.json").write_text(
        json.dumps(candidatos, indent=1))
    from collections import Counter
    print(f"{len(candidatos)} candidatos",
          dict(Counter(c['fonte'] for c in candidatos)),
          dict(Counter(c['hora'] for c in candidatos)))


if __name__ == "__main__":
    main()
