#!/usr/bin/env python3
"""Build a compact, reproducible listing sample for the static GitHub Pages explorer."""

import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "realtor-data.zip.csv"
OUTPUT = ROOT / "assets" / "listings-sample.json"
SAMPLE_SIZE = 50_000
SEED = 42
COLUMNS = ["status", "price", "bed", "bath", "acre_lot", "city", "state",
           "zip_code", "house_size", "prev_sold_date", "brokered_by"]


def clean(value):
    if pd.isna(value):
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        value = float(value)
        return int(value) if value.is_integer() else round(value, 3)
    return str(value)


def main():
    if not CSV.exists():
        raise SystemExit(f"Missing source CSV: {CSV}")
    frame = pd.read_csv(CSV, usecols=COLUMNS,
                        dtype={"zip_code": "string", "prev_sold_date": "string"},
                        low_memory=False)[COLUMNS]
    count = min(SAMPLE_SIZE, len(frame))
    indices = np.sort(np.random.default_rng(SEED).choice(len(frame), size=count, replace=False))
    rows = [[int(index) + 1, *[clean(value) for value in values]]
            for index, values in zip(indices, frame.iloc[indices].itertuples(index=False, name=None))]
    payload = {"source_total": len(frame), "sample_size": count,
               "columns": ["id", *COLUMNS], "rows": rows}
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                      encoding="utf-8")
    print(f"Wrote {count:,} listings to {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
