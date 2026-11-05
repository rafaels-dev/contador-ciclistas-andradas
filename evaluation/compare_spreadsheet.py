#!/usr/bin/env python3
"""
Final comparison: our count × the "2026" tab of Cristiano's spreadsheet
(manual GT per hour) × the "IA" column (old algorithm). Focus: cyclists.

Usage: python evaluation/compare_spreadsheet.py [--sweep evaluation/sweep_v9]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy

# "2026" tab of Andradas.xlsx (Jul 20, 2026): hour → (ped, cyc, mot, car, old_ai_cyc)
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


def load_table(sweep: Path) -> dict:
    """table.json from sweep_all.py (or the old tabela.json, Portuguese keys)."""
    p = legacy.first_existing(sweep / "table.json", sweep / "tabela.json")
    table = json.loads(p.read_text(encoding="utf-8"))
    return {h: legacy.summary(row) for h, row in table.items()}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sweep", default=None, help="default: evaluation/sweep_v9 (or the old varredura_v9)")
    args = p.parse_args()
    tab = load_table(Path(args.sweep) if args.sweep else legacy.local("sweep_v9", "varredura_v9"))

    print(f"{'h':>3} | {'cyc_GT':>6} {'cyc_AI':>7} {'cyc_ours':>9} {'err_AI':>7} {'err_ours':>9} | "
          f"{'ped GT/ours':>13} {'mot GT/ours':>13} {'car GT/ours':>13}")
    acc = dict(gt=0, ai=0, ours=0, e_ai=0, e_ours=0)
    for h in sorted(GT):
        hh = f"{h:02d}"
        if hh not in tab:
            continue
        t = tab[hh]["totals"]
        ped, cyc, mot, car, ai = GT[h]
        e_ai, e_n = abs(ai - cyc), abs(t["cyclists"] - cyc)
        acc["gt"] += cyc; acc["ai"] += ai; acc["ours"] += t["cyclists"]
        acc["e_ai"] += e_ai; acc["e_ours"] += e_n
        print(f"{h:>3} | {cyc:>6} {ai:>7} {t['cyclists']:>9} {e_ai:>7} {e_n:>9} | "
              f"{ped:>5}/{t['pedestrians']:<7} {mot:>5}/{t['motorcycles']:<7} "
              f"{car:>5}/{t['cars']:<7}")
    print("-" * 100)
    print(f"TOT | {acc['gt']:>6} {acc['ai']:>7} {acc['ours']:>9} "
          f"{acc['e_ai']:>7} {acc['e_ours']:>9}")
    print(f"\nmean absolute error per hour — old AI: {acc['e_ai']/len(GT):.1f} | "
          f"ours: {acc['e_ours']/len(GT):.1f}")
    day = [h for h in GT if 6 <= h <= 16]
    e_ai_d = sum(abs(GT[h][4]-GT[h][1]) for h in day)
    e_n_d = sum(abs(tab[f'{h:02d}']['totals']['cyclists']-GT[h][1]) for h in day if f'{h:02d}' in tab)
    print(f"daytime hours only (6-16): AI error {e_ai_d} | our error {e_n_d}")


if __name__ == "__main__":
    main()
