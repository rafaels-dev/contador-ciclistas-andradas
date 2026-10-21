#!/usr/bin/env python3
"""
Varredura final: processa todos os vídeos horários com o contador atual
e consolida uma tabela por hora (4 categorias × in/out) em JSON e texto.

Uso: python avaliacao/varrer_tudo.py [--dir avaliacao/videos] [--saida avaliacao/varredura]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="avaliacao/videos")
    p.add_argument("--saida", default="avaliacao/varredura")
    args = p.parse_args()

    raiz = Path(__file__).resolve().parent.parent
    videos = sorted(Path(args.dir).glob("Andradas_*.mp4"))
    videos = [v for v in videos if re.fullmatch(r"Andradas_\d\d\.mp4", v.name)]
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)

    tabela = {}
    for v in videos:
        hora = v.stem.split("_")[1]
        diag = saida / f"diag_{hora}"
        resumo_f = diag / "resumo.json"
        if not resumo_f.exists():
            print(f"[{hora}] processando {v.name} ...", flush=True)
            r = subprocess.run(
                [sys.executable, str(raiz / "avaliacao/rodar_instrumentado.py"),
                 "--video", str(v), "--saida", str(diag),
                 "--max-snapshots", "150"],
                capture_output=True, text=True)
            if r.returncode != 0:
                print(f"[{hora}] FALHOU: {r.stderr[-500:]}", flush=True)
                continue
        d = json.loads(resumo_f.read_text())
        tabela[hora] = {"totais": d["totais"], "direcoes": d["direcoes"],
                        "por_motivo": d["por_motivo"]}
        print(f"[{hora}] {d['totais']}", flush=True)

    (saida / "tabela.json").write_text(json.dumps(tabela, indent=1, ensure_ascii=False))

    # tabela texto
    linhas = [f"{'hora':>4} {'cic':>5} {'ped':>5} {'aut':>5} {'mot':>5}"]
    tot = {"ciclistas": 0, "pedestres": 0, "automoveis": 0, "motocicletas": 0}
    for hora in sorted(tabela):
        t = tabela[hora]["totais"]
        for k in tot:
            tot[k] += t[k]
        linhas.append(f"{hora:>4} {t['ciclistas']:>5} {t['pedestres']:>5} "
                      f"{t['automoveis']:>5} {t['motocicletas']:>5}")
    linhas.append(f"{'TOT':>4} {tot['ciclistas']:>5} {tot['pedestres']:>5} "
                  f"{tot['automoveis']:>5} {tot['motocicletas']:>5}")
    texto = "\n".join(linhas)
    (saida / "tabela.txt").write_text(texto)
    print(texto)


if __name__ == "__main__":
    main()
