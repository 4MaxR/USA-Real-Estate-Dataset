#!/usr/bin/env python3
"""
USA Real Estate — data profiling & KPI computation.
Reads ../data/realtor-data.zip.csv and prints a JSON report.

Usage:  python scripts/analyze_data.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent.parent / "data"
CSV = BASE / "realtor-data.zip.csv"

df = pd.read_csv(CSV, low_memory=False)

OUT = {}
OUT["shape"] = {"rows": len(df), "columns": list(df.columns)}

# ---- missing-value profile (empty strings treated as missing) ----
missing = {}
for c in df.columns:
    empty_str = (df[c].astype(str).str.strip() == "") if df[c].dtype == object else pd.Series(False, index=df.index)
    nulls = df[c].isna()
    missing[c] = round(100 * (nulls | empty_str).sum() / len(df), 2)
OUT["missing_pct"] = missing

# ---- status ----
status = df["status"].astype(str).str.strip().replace({"": "missing"})
sc = status.value_counts()
OUT["status"] = {k: int(v) for k, v in sc.items()}

# ---- numeric coercion ----
num = {}
for c in ["price", "bed", "bath", "acre_lot", "house_size"]:
    s = pd.to_numeric(df[c], errors="coerce")
    num[c] = {
        "non_null": int(s.notna().sum()),
        "min": None if s.notna().sum() == 0 else float(s.min()),
        "max": None if s.notna().sum() == 0 else float(s.max()),
        "mean": None if s.notna().sum() == 0 else round(float(s.mean()), 2),
        "median": None if s.notna().sum() == 0 else round(float(s.median()), 2),
        "zeros": int((s == 0).sum()),
    }
OUT["numeric"] = num

# ---- price by status (valid prices only) ----
price = pd.to_numeric(df["price"], errors="coerce")
valid_price = (price > 0) & (price < 5_000_000_000)  # drop $0 and absurd outliers
price_clean = price[valid_price]
OUT["price_valid_pct"] = round(100 * valid_price.sum() / len(df), 2)
OUT["price_stats"] = {
    "mean": round(float(price_clean.mean()), 0),
    "median": round(float(price_clean.median()), 0),
    "q25": round(float(price_clean.quantile(0.25)), 0),
    "q75": round(float(price_clean.quantile(0.75)), 0),
    "p99": round(float(price_clean.quantile(0.99)), 0),
    "max": round(float(price_clean.max()), 0),
}
st = status
price_by_status = {}
for s in ["for_sale", "sold"]:
    m = (st == s) & valid_price
    if m.sum() > 0:
        price_by_status[s] = {
            "listings": int(m.sum()),
            "median": round(float(price_clean[m].median()), 0),
            "mean": round(float(price_clean[m].mean()), 0),
        }
OUT["price_by_status"] = price_by_status

# ---- price per sqft ----
sqft = pd.to_numeric(df["house_size"], errors="coerce")
pps = price_clean / sqft
valid_pps = (sqft > 0) & (pps > 1) & (pps < 5000) & valid_price
OUT["pps_stats"] = {
    "valid": int(valid_pps.sum()),
    "median": round(float(pps[valid_pps].median()), 0),
    "mean": round(float(pps[valid_pps].mean()), 0),
}

# ---- geography: state level ----
state = df["state"].astype(str).str.strip().replace({"": "missing"})
by_state = df.assign(state=state, price=price_clean).query("price > 0")
g = by_state.groupby("state")["price"].agg(["count", "median", "mean"])
g = g[g.index != "missing"].sort_values("count", ascending=False)
OUT["state_top15_by_volume"] = {
    st: {"listings": int(r["count"]), "median_price": round(float(r["median"]), 0)}
    for st, r in g.head(15).iterrows()
}
OUT["state_count"] = int(g.shape[0])

# ---- beds / baths ----
bed = pd.to_numeric(df["bed"], errors="coerce")
bath = pd.to_numeric(df["bath"], errors="coerce")
valid_bed = (bed > 0) & (bed <= 20)
beds_med = pd.DataFrame({"bed": bed[valid_bed & valid_price], "price": price_clean[valid_bed & valid_price]})
gb = beds_med.groupby("bed")["price"].agg(["count", "median"])
OUT["price_by_bed"] = {int(k): {"listings": int(r["count"]), "median_price": round(float(r["median"]), 0)}
                       for k, r in gb.head(12).iterrows()}
OUT["bed_stats"] = {"valid_pct": round(100 * valid_bed.sum() / len(df), 2), "median": float(bed[valid_bed].median())}
OUT["bath_stats"] = {"median": float(bath[(bath > 0) & (bath <= 20)].median())}

# ---- city concentration ----
city = df["city"].astype(str).str.strip().replace({"": "missing"})
cc = city.value_counts()
OUT["city_top10"] = {k: int(v) for k, v in cc.head(10).items()}
OUT["city_count"] = int((cc.index != "missing").sum())

# ---- duplicates ----
dup = df.duplicated().sum()
OUT["exact_duplicates"] = int(dup)
dup_rate = round(100 * dup / len(df), 3)
OUT["dup_pct"] = dup_rate

# ---- street junk detection ----
street = df["street"].astype(str).str.strip()
numeric_street = street.str.fullmatch(r"-?\d+(\.\d+)?", na=False).sum()
OUT["street_numeric_junk"] = int(numeric_street)
OUT["street_numeric_junk_pct"] = round(100 * numeric_street / len(df), 2)

# ---- prev_sold_date coverage (use isna — column is StringDtype, NA != 'nan') ----
psd = df["prev_sold_date"]
OUT["prev_sold_date_coverage_pct"] = round(100 * (1 - psd.isna().sum() / len(df)), 2)
OUT["prev_sold_date_valid_dates"] = int(psd.astype(str).str.match(r"^\d{4}-\d{2}-\d{2}", na=False).sum())

# ---- price outliers ----
OUT["price_outliers_over_10m"] = int((price_clean > 10_000_000).sum())

print(json.dumps(OUT, indent=1, default=str))
