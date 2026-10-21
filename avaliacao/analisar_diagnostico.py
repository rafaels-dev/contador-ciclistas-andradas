#!/usr/bin/env python3
"""
Analisa a saída do rodar_instrumentado.py e aponta suspeitas:

  1. contado_sem_cruzar   — track contado cujo cx nunca passou pela linha
  2. direcao_invertida    — contado na "entrada" com direção oposta ao movimento real
  3. cruzou_sem_contar    — track que atravessou a linha mas nunca foi contado
  4. possivel_duplicata   — dois eventos da mesma categoria próximos em tempo/espaço

Uso: python avaliacao/analisar_diagnostico.py avaliacao/diag_07 [--linha-x 960]
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("dir")
    p.add_argument("--linha-x", type=float, default=960)
    p.add_argument("--min-frames", type=int, default=3,
                   help="ignora tracks mais curtos que isso em cruzou_sem_contar")
    args = p.parse_args()
    d = Path(args.dir)
    LX = args.linha_x

    tracks = json.loads((d / "tracks.json").read_text())
    eventos = [json.loads(l) for l in (d / "eventos.jsonl").read_text().splitlines()]

    tr_por_chave = {(t["cat"], t["tid"]): t for t in tracks}
    ev_por_chave = defaultdict(list)
    for ev in eventos:
        ev_por_chave[(ev["categoria"], ev["tid"])].append(ev)

    rel = {"contado_sem_cruzar": [], "direcao_invertida": [],
           "cruzou_sem_contar": [], "possivel_duplicata": []}

    # 1 e 2 — sobre eventos contados
    for ev in eventos:
        t = tr_por_chave.get((ev["categoria"], ev["tid"]))
        if t is None:
            continue
        cruzou = t["cxmin"] < LX <= t["cxmax"]
        if not cruzou:
            rel["contado_sem_cruzar"].append({**ev, "cx_range": [t["cxmin"], t["cxmax"]],
                                              "frames": [t["f0"], t["f1"]]})
        if ev["motivo"] == "entrada" and t["n"] >= 3:
            dx = t["cx1"] - t["cx0"]
            # lado "esq" = in = direita→esquerda = dx negativo esperado
            if abs(dx) > 30:
                esperado = "esq" if dx < 0 else "dir"
                if ev["lado"] != esperado:
                    rel["direcao_invertida"].append({**ev, "dx": round(dx, 1)})

    # 3 — tracks que cruzaram e nunca foram contados
    contados = set(ev_por_chave.keys())
    for t in tracks:
        if (t["cat"], t["tid"]) in contados:
            continue
        if t["n"] < args.min_frames:
            continue
        if t["cxmin"] < LX <= t["cxmax"] and abs(t["cx1"] - t["cx0"]) > 60:
            rel["cruzou_sem_contar"].append(t)

    # 4 — eventos próximos em tempo (≤ 5 s) e espaço na mesma categoria/direção
    por_cat = defaultdict(list)
    for ev in eventos:
        por_cat[ev["categoria"]].append(ev)
    for cat, evs in por_cat.items():
        evs.sort(key=lambda e: e["frame_video"])
        for i in range(len(evs) - 1):
            a, b = evs[i], evs[i + 1]
            if b["frame_video"] - a["frame_video"] <= 75 and a["lado"] == b["lado"]:
                rel["possivel_duplicata"].append(
                    {"cat": cat, "lado": a["lado"],
                     "frames": [a["frame_video"], b["frame_video"]],
                     "tids": [a["tid"], b["tid"]],
                     "motivos": [a["motivo"], b["motivo"]]})

    resumo = {k: len(v) for k, v in rel.items()}
    resumo["total_eventos"] = len(eventos)
    resumo["total_tracks"] = len(tracks)
    print(json.dumps(resumo, indent=2))
    (d / "analise.json").write_text(json.dumps(rel, indent=2, ensure_ascii=False))
    print(f"detalhes em {d/'analise.json'}")


if __name__ == "__main__":
    main()
