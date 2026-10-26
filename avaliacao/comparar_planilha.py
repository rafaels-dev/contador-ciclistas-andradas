#!/usr/bin/env python3
"""
Comparação final: nossa contagem × aba "2026" da planilha do Cristiano
(GT manual por hora) × coluna "IA" (algoritmo antigo). Foco: Ciclistas.

Uso: python avaliacao/comparar_planilha.py [--varredura avaliacao/varredura_v9]
"""
import argparse
import json
from pathlib import Path

# aba 2026 da Andradas.xlsx (20/jul/2026): hora → (ped, cic, mot, car, IA_cic)
GT = {
    5:  (16, 13, 0, 54, 7),
    6:  (39, 41, 42, 292, 22),
    7:  (68, 63, 130, 434, 48),
    8:  (82, 47, 113, 279, 43),
    9:  (62, 43, 68, 179, 37),
    10: (53, 37, 58, 184, 33),
    11: (44, 37, 65, 181, 36),
    12: (25, 38, 48, 196, 35),
    13: (20, 26, 81, 190, 24),
    14: (24, 25, 76, 161, 19),
    15: (30, 28, 51, 129, 19),
    16: (44, 58, 60, 173, 51),
    17: (85, 70, 29, 171, 42),
    18: (94, 85, 75, 140, 14),
    19: (88, 53, 2, 115, 10),
    20: (61, 34, 1, 59, 10),
    21: (29, 14, 27, 49, 9),
    22: (25, 22, 0, 37, 2),
    23: (19, 8, 11, 12, 3),
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--varredura", default="avaliacao/varredura_v9")
    args = p.parse_args()
    tab = json.loads((Path(args.varredura) / "tabela.json").read_text())

    print(f"{'h':>3} | {'cic_GT':>6} {'cic_IA':>7} {'cic_nosso':>9} {'err_IA':>7} {'err_nosso':>9} | "
          f"{'ped GT/nosso':>13} {'mot GT/nosso':>13} {'car GT/nosso':>13}")
    soma = dict(gt=0, ia=0, nosso=0, e_ia=0, e_nosso=0)
    for h in sorted(GT):
        hh = f"{h:02d}"
        if hh not in tab:
            continue
        t = tab[hh]["totais"]
        ped, cic, mot, car, ia = GT[h]
        e_ia, e_n = abs(ia - cic), abs(t["ciclistas"] - cic)
        soma["gt"] += cic; soma["ia"] += ia; soma["nosso"] += t["ciclistas"]
        soma["e_ia"] += e_ia; soma["e_nosso"] += e_n
        print(f"{h:>3} | {cic:>6} {ia:>7} {t['ciclistas']:>9} {e_ia:>7} {e_n:>9} | "
              f"{ped:>5}/{t['pedestres']:<7} {mot:>5}/{t['motocicletas']:<7} "
              f"{car:>5}/{t['automoveis']:<7}")
    print("-" * 100)
    print(f"TOT | {soma['gt']:>6} {soma['ia']:>7} {soma['nosso']:>9} "
          f"{soma['e_ia']:>7} {soma['e_nosso']:>9}")
    print(f"\nerro absoluto médio por hora — IA antiga: {soma['e_ia']/len(GT):.1f} | "
          f"nosso: {soma['e_nosso']/len(GT):.1f}")
    dia = [h for h in GT if 6 <= h <= 16]
    e_ia_d = sum(abs(GT[h][4]-GT[h][1]) for h in dia)
    e_n_d = sum(abs(tab[f'{h:02d}']['totais']['ciclistas']-GT[h][1]) for h in dia if f'{h:02d}' in tab)
    print(f"só horas diurnas (6-16): erro IA {e_ia_d} | erro nosso {e_n_d}")


if __name__ == "__main__":
    main()
