#!/usr/bin/env python3
"""
USA Real Estate — data profiling, KPIs, and dashboard data.

Reads data/realtor-data.zip.csv, prints a short report, and writes every number the
dashboard and README use to assets/analysis.json. Self-checks fail loudly if an
aggregate stops adding up.

Usage:  python scripts/analyze_data.py
"""
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "realtor-data.zip.csv"
OUTPUT = ROOT / "assets" / "analysis.json"

# ---- validity windows (applied per metric; rows are never deleted) ----
PRICE_MIN = 1_000            # $0–$999 are placeholders, not prices
PRICE_MAX = 1_000_000_000    # removes the int32 overflow (2,147,483,600) and a $1B placeholder
SIZE_MIN, SIZE_MAX = 100, 50_000
BED_MAX = BATH_MAX = 20
PPS_MIN, PPS_MAX = 1, 5_000
MIN_STATE_ROWS = 1_000       # smaller groups are reported but not ranked
MIN_CELL = 30                # a median needs at least this many rows to be shown

HIST_EDGES = [10 ** (4 + k / 8) for k in range(29)]   # $10K → $31.6M, 1/8-decade bins
SIZE_BANDS = [0, 1_000, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000, 7_500, 10_000, SIZE_MAX + 1]
SIZE_LABELS = ["<1K", "1–1.5K", "1.5–2K", "2–2.5K", "2.5–3K", "3–4K", "4–5K",
               "5–7.5K", "7.5–10K", "10K+"]
BED_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9+"]
STATUS_BED_LABELS = ["1", "2", "3", "4", "5", "6"]
TERRITORIES = {"District of Columbia", "Puerto Rico", "Virgin Islands", "Guam"}


def rnd(x, digits=0):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    value = round(float(x), digits)
    return int(value) if digits == 0 else value


def median_or_none(series, minimum=MIN_CELL):
    return rnd(series.median()) if len(series) >= minimum else None


def weighted_median(values, weights):
    order = np.argsort(values)
    values, weights = values[order], weights[order]
    cumulative = np.cumsum(weights)
    return float(values[np.searchsorted(cumulative, cumulative[-1] / 2)])


def adjusted_eta2(y, groups):
    """Share of variance in y explained by group means, adjusted for group count."""
    n, k = len(y), groups.nunique()
    within = ((y - y.groupby(groups, observed=True).transform("mean")) ** 2).sum()
    total = ((y - y.mean()) ** 2).sum()
    return 1 - (within / (n - k)) / (total / (n - 1))


def segment(frame):
    """Every aggregate the dashboard shows for one geography."""
    priced = frame[frame.price_ok]
    pps = frame[frame.pps_ok]
    status = frame.status.value_counts()
    hist, _ = np.histogram(priced.price, bins=HIST_EDGES)
    bedded = priced[priced.bed_ok]
    bed_group = bedded.bed.clip(upper=9).astype(int)
    status_bed = bedded[bedded.bed <= 6]
    return {
        "records": len(frame),
        "priced": len(priced),
        "median_price": median_or_none(priced.price, 1),
        "mean_price": rnd(priced.price.mean()) if len(priced) else None,
        "median_pps": median_or_none(pps.pps, 1),
        "pps_records": len(pps),
        "status": {s: int(status.get(s, 0)) for s in ["for_sale", "sold", "ready_to_build"]},
        "hist": hist.tolist(),
        "hist_below": int((priced.price < HIST_EDGES[0]).sum()),
        "hist_above": int((priced.price >= HIST_EDGES[-1]).sum()),
        "pps_by_size": [
            {"median": median_or_none(g.pps), "n": len(g)}
            for _, g in pps.groupby(pd.cut(pps.house_size, SIZE_BANDS, right=False), observed=False)
        ],
        "price_by_bed": [
            {"median": median_or_none(bedded.price[bed_group == b]), "n": int((bed_group == b).sum())}
            for b in range(1, 10)
        ],
        "status_by_bed": {
            s: [median_or_none(status_bed.price[(status_bed.status == s) & (status_bed.bed == b)])
                for b in range(1, 7)]
            for s in ["for_sale", "sold"]
        },
        "status_median": {
            s: median_or_none(priced.price[priced.status == s]) for s in ["for_sale", "sold"]
        },
    }


print("loading...")
df = pd.read_csv(CSV, dtype={"zip_code": "string", "prev_sold_date": "string"},
                 low_memory=False)
rows = len(df)

# ---- validity flags ----
df["price_ok"] = df.price.between(PRICE_MIN, PRICE_MAX, inclusive="left")
df["size_ok"] = df.house_size.between(SIZE_MIN, SIZE_MAX)
df["bed_ok"] = df.bed.between(1, BED_MAX)
df["pps"] = df.price / df.house_size
df["pps_ok"] = df.price_ok & df.size_ok & df.pps.between(PPS_MIN, PPS_MAX, inclusive="neither")
priced = df[df.price_ok]

# ---- headline KPIs ----
median_price = float(priced.price.median())
mean_price = float(priced.price.mean())
kpi = {
    "records": rows,
    "priced": len(priced),
    "priced_pct": rnd(100 * len(priced) / rows, 2),
    "median_price": rnd(median_price),
    "mean_price": rnd(mean_price),
    "mean_over_median_pct": rnd(100 * (mean_price / median_price - 1), 1),
    "q25": rnd(priced.price.quantile(0.25)),
    "q75": rnd(priced.price.quantile(0.75)),
    "p99": rnd(priced.price.quantile(0.99)),
    "median_pps": rnd(df.pps[df.pps_ok].median()),
    "pps_records": int(df.pps_ok.sum()),
    "status": {k: int(v) for k, v in df.status.value_counts().items()},
    "zip_codes": int(df.zip_code.nunique()),
    "cities": int(df[["city", "state"]].dropna().drop_duplicates().shape[0]),
}

# ---- geography coverage (the 'state' column is not just states) ----
state_counts = df.state.value_counts()
coverage = {
    "values": int(state_counts.size),
    "us_states": int(sum(1 for s in state_counts.index if s not in TERRITORIES and s != "New Brunswick")),
    "dc_and_territories": sorted(s for s in state_counts.index if s in TERRITORIES),
    "foreign": {"New Brunswick": int(state_counts.get("New Brunswick", 0))},
    "top3_share_pct": rnd(100 * state_counts.head(3).sum() / rows, 1),
    "top3": state_counts.head(3).index.tolist(),
}

# ---- data quality ----
missing = {c: rnd(100 * df[c].isna().mean(), 2) for c in
           ["brokered_by", "status", "price", "bed", "bath", "acre_lot", "street",
            "city", "state", "zip_code", "house_size", "prev_sold_date"]}

street_zips = df.dropna(subset=["street", "zip_code"]).groupby("street").zip_code.nunique()
key = ["street", "zip_code", "bed", "bath", "house_size", "acre_lot"]
keyed = df.dropna(subset=["street"])
group_id = keyed.groupby(key, dropna=False).ngroup()
group_size = group_id.map(group_id.value_counts())
repeat = keyed[group_size > 1].assign(g=group_id[group_size > 1])
repeat_status = repeat.groupby("g").status.agg(lambda s: "+".join(sorted(set(s))))
repeat_prices = repeat.groupby("g").price.nunique()

prev_sold = pd.to_datetime(df.prev_sold_date, errors="coerce")
sold_dates = prev_sold[(df.status == "sold") & (prev_sold < "2025-01-01")]

quality = {
    "exact_duplicates": int(df.duplicated(subset=[c for c in df.columns if c in missing]).sum()),
    "street_ids": int(df.street.nunique()),
    "street_single_zip_pct": rnd(100 * (street_zips == 1).mean(), 1),
    "repeat_extra_records": int(keyed.duplicated(subset=key, keep="first").sum()),
    "repeat_groups": int(repeat_status.size),
    "repeat_forsale_and_sold_pct": rnd(100 * (repeat_status == "for_sale+sold").mean(), 1),
    "repeat_same_price_pct": rnd(100 * (repeat_prices == 1).mean(), 1),
    "price_zero": int((df.price == 0).sum()),
    "price_under_1000": int((df.price < PRICE_MIN).sum()),
    "price_over_1b": int((df.price >= PRICE_MAX).sum()),
    "price_max": rnd(df.price.max()),
    "price_over_10m": int((priced.price > 10_000_000).sum()),
    "size_over_50k": int((df.house_size > SIZE_MAX).sum()),
    "size_max": rnd(df.house_size.max()),
    "bed_over_20": int((df.bed > BED_MAX).sum()),
    "bath_over_20": int((df.bath > BATH_MAX).sum()),
    "bed_max": rnd(df.bed.max()),
    "bath_max": rnd(df.bath.max()),
    "prev_sold_valid": int(prev_sold.notna().sum()),
    "prev_sold_coverage_pct": rnd(100 * prev_sold.notna().mean(), 1),
    "prev_sold_out_of_range": int(((prev_sold > "2025-01-01") | (prev_sold < "1950-01-01")).sum()),
    "sold_with_date_pct": rnd(100 * prev_sold[df.status == "sold"].notna().mean(), 1),
    "sold_window": [str(sold_dates.min().date()), str(sold_dates.max().date())],
}
quality["repeat_extra_pct"] = rnd(100 * quality["repeat_extra_records"] / rows, 1)

# ---- what explains price? (one common sample, log price, adjusted eta²) ----
model = df[df.pps_ok & df.bed_ok].copy()
model["log_price"] = np.log(model.price)
model["size_band"] = pd.qcut(model.house_size, 20, duplicates="drop")
model["bed_group"] = model.bed.clip(upper=7)
model["city_key"] = model.city.astype(str) + ", " + model.state.astype(str)
size_fit = model.groupby("size_band", observed=True).log_price.transform("mean")
residual = model.log_price - size_fit
factors = [("zip_code", "ZIP code"), ("city_key", "City"), ("size_band", "House size"),
           ("state", "State"), ("bed_group", "Bedrooms")]
drivers = []
for column, label in factors:
    drivers.append({
        "factor": label,
        "groups": int(model[column].nunique()),
        "explained_pct": rnd(100 * adjusted_eta2(model.log_price, model[column]), 1),
        "after_size_pct": None if column == "size_band"
        else rnd(100 * adjusted_eta2(residual, model[column]), 1),
    })
slope, _ = np.polyfit(np.log(model.house_size), model.log_price, 1)

# ---- sold vs for-sale: raw medians vs the same state / bedroom mix ----
for_sale = priced[priced.status == "for_sale"]
sold = priced[priced.status == "sold"]
state_weight = (for_sale.state.value_counts(normalize=True)
                / sold.state.value_counts(normalize=True))
cell = lambda f: f.state + "|" + f.bed.clip(upper=6).fillna(0).astype(int).astype(str)
cell_weight = cell(for_sale).value_counts(normalize=True) / cell(sold).value_counts(normalize=True)
mix = {
    "for_sale_median": rnd(for_sale.price.median()),
    "sold_median": rnd(sold.price.median()),
    "sold_median_state_mix": rnd(weighted_median(
        sold.price.to_numpy(), sold.state.map(state_weight).fillna(0).to_numpy())),
    "sold_median_state_bed_mix": rnd(weighted_median(
        sold.price.to_numpy(), cell(sold).map(cell_weight).fillna(0).to_numpy())),
    "california_share_sold_pct": rnd(100 * (sold.state == "California").mean(), 1),
    "california_share_for_sale_pct": rnd(100 * (for_sale.state == "California").mean(), 1),
}

# ---- per-geography aggregates for the dashboard ----
segments = {"All": segment(df)}
for name in state_counts.index:
    segments[name] = segment(df[df.state == name])

# ---- self-checks ----
all_seg = segments["All"]
assert sum(all_seg["hist"]) + all_seg["hist_below"] + all_seg["hist_above"] == len(priced)
assert sum(s["records"] for n, s in segments.items() if n != "All") == rows - df.state.isna().sum()
assert sum(b["n"] for b in all_seg["pps_by_size"]) == all_seg["pps_records"]
assert all_seg["median_price"] == kpi["median_price"]
assert quality["price_max"] >= PRICE_MAX, "overflow artifact should sit above the price ceiling"

report = {
    "generated": date.today().isoformat(),
    "source": "data/realtor-data.zip.csv",
    "bounds": {"price": [PRICE_MIN, PRICE_MAX], "house_size": [SIZE_MIN, SIZE_MAX],
               "bed": [1, BED_MAX], "price_per_sqft": [PPS_MIN, PPS_MAX],
               "min_state_records": MIN_STATE_ROWS, "min_cell": MIN_CELL},
    "kpi": kpi,
    "coverage": coverage,
    "missing_pct": missing,
    "quality": quality,
    "drivers": {"sample": len(model), "size_elasticity": rnd(slope, 3), "factors": drivers},
    "status_mix": mix,
    "hist_edges": [rnd(e) for e in HIST_EDGES],
    "size_bands": SIZE_LABELS,
    "bed_labels": BED_LABELS,
    "status_bed_labels": STATUS_BED_LABELS,
    "segments": segments,
}
OUTPUT.parent.mkdir(exist_ok=True)
OUTPUT.write_text(json.dumps(report, separators=(",", ":")), encoding="utf-8")

# ---- console summary ----
print(f"rows {rows:,}  |  priced {kpi['priced']:,} ({kpi['priced_pct']}%)")
print(f"median ${kpi['median_price']:,}  |  mean ${kpi['mean_price']:,} "
      f"(+{kpi['mean_over_median_pct']}%)  |  p99 ${kpi['p99']:,}  |  median $/sqft {kpi['median_pps']}")
print("price per sqft by size:",
      {l: b["median"] for l, b in zip(SIZE_LABELS, all_seg["pps_by_size"])})
print("price by bed:", {l: b["median"] for l, b in zip(BED_LABELS, all_seg["price_by_bed"])})
print(f"size elasticity {slope:.3f}  |  drivers:",
      {d["factor"]: (d["explained_pct"], d["after_size_pct"]) for d in drivers})
print("sold vs for-sale:", mix)
print(f"repeat records {quality['repeat_extra_records']:,} ({quality['repeat_extra_pct']}%)  |  "
      f"{quality['repeat_forsale_and_sold_pct']}% for-sale+sold  |  "
      f"street ids in one ZIP {quality['street_single_zip_pct']}%")
print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes)")
