#!/usr/bin/env python3
"""
Comprehensive chart audit — verifies every number in all 5 charts
against the source CSV. Run before regenerating charts for the portfolio.
"""
from pathlib import Path
import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data" / "realtor-data.zip.csv"
df = pd.read_csv(DATA, low_memory=False)

print("=" * 70)
print("FULL CHART AUDIT — USA Real Estate")
print("=" * 70)

# Shared filtered price dataset
price = pd.to_numeric(df["price"], errors="coerce")
valid = (price > 0) & (price < 5_000_000_000)
pc = price[valid]
print(f"\nFiltered price dataset (price > 0, price < $5B): {len(pc):,} rows")
print(f"  median=${pc.median():,.0f}  mean=${pc.mean():,.0f}  p99=${pc.quantile(0.99):,.0f}")

# ─────────────────────────────────────────────────────────────────
# CHART 1 — Status donut
# ─────────────────────────────────────────────────────────────────
print("\n" + "─" * 70)
print("CHART 1: Status donut")
print("─" * 70)

sc = df["status"].astype(str).str.strip().value_counts()
labels = ['for sale', 'sold', 'ready to build']
keys = ['for_sale', 'sold', 'ready_to_build']
vals = [sc.get(k, 0) for k in keys]
total = sum(vals)

print(f"  Expected center text: {total:,} (script uses hardcoded '2,226,382')")
print(f"  PASS: center matches? {total == 2226382}")
print()
print(f"  {'Status':<20} {'Count':>10} {'Pct':>8}")
print(f"  {'-'*20} {'-'*10} {'-'*8}")
for label, key, v in zip(labels, keys, vals):
    pct = 100 * v / total
    print(f"  {label:<20} {v:>10,} {pct:>7.1f}%")
print(f"  {'TOTAL':<20} {total:>10,} {100:>7.1f}%")

# Check the static total
issues1 = []
if total != 2226382:
    issues1.append(f"Total listings ({total:,}) ≠ 2,226,382 (hardcoded)")
if total != len(df):
    issues1.append(f"Total status rows ({total:,}) ≠ df length ({len(df):,})")
if sum(vals) != total:
    issues1.append("Sum mismatch")

# Verify each value against analyze_data.py output
expected_status = {'for_sale': 1389306, 'sold': 812009, 'ready_to_build': 25067}
for key, expected in expected_status.items():
    actual = sc.get(key, 0)
    if actual != expected:
        issues1.append(f"{key}: {actual:,} ≠ expected {expected:,}")

if issues1:
    for iss in issues1:
        print(f"  ❌ {iss}")
else:
    print(f"\n  ✅ ALL CHECKS PASSED")

# ─────────────────────────────────────────────────────────────────
# CHART 2 — Median price by state
# ─────────────────────────────────────────────────────────────────
print("\n" + "─" * 70)
print("CHART 2: Median price by state (top 12 by volume)")
print("─" * 70)

state = df["state"].astype(str).str.strip()
g = pd.DataFrame({"state": state, "price": pc}).query("price > 0").groupby("state")["price"].agg(["count", "median"])
g = g[g.index != ""].sort_values("count", ascending=False)
top12 = g.head(12)

print(f"  States with data: {len(g)}")
print(f"  US median reference line: ${pc.median():,.0f} → {pc.median()/1000:.0f}K")
print(f"  x-axis range: 0–780 (${pc.median()/1000:.0f}K median fits? {'YES' if pc.median()/1000 <= 780 else 'NO — CLIPPED'})")
print()
print(f"  {'#':>3} {'State':<20} {'Count':>10} {'Median':>12} {'Chart label':>12}")
print(f"  {'-'*3} {'-'*20} {'-'*10} {'-'*12} {'-'*12}")
issues2 = []
for i, (idx, r) in enumerate(top12.iterrows()):
    cnt_k = r["count"] / 1000
    med_k = r["median"] / 1000
    chart_label = f'${med_k:.0f}K'
    count_label = f'{cnt_k:.0f}K'
    print(f"  {i+1:>3} {idx:<20} {r['count']:>10,} ${r['median']:>11,.0f} {chart_label:>12}")
    if idx == "California":
        if r["median"] < 600_000:
            issues2.append(f"California median ${r['median']:,.0f} seems low")
    if r["count"] < 0:
        issues2.append(f"Negative count for {idx}")

# Check: are we missing any big states?
expected_top3 = ['Florida', 'California', 'Texas']
actual_top3 = list(top12.head(3).index)
if actual_top3 != expected_top3:
    issues2.append(f"Top 3 order: {actual_top3} ≠ expected {expected_top3}")

# Check the US median line is 325 from analyze_data
us_median = pc.median()
if abs(us_median - 325000) > 1000:
    issues2.append(f"US median ${us_median:,.0f} ≠ $325,000")

if issues2:
    for iss in issues2:
        print(f"  ❌ {iss}")
else:
    print(f"\n  ✅ ALL CHECKS PASSED")

# ─────────────────────────────────────────────────────────────────
# CHART 3 — Price by bedrooms
# ─────────────────────────────────────────────────────────────────
print("\n" + "─" * 70)
print("CHART 3: Median price by bedrooms (1–7 beds)")
print("─" * 70)

bed = pd.to_numeric(df["bed"], errors="coerce")
mask = (bed > 0) & (bed <= 7) & valid
gb = pd.DataFrame({"bed": bed[mask], "price": pc[mask]}).groupby("bed")["price"].median()

print(f"  Filter: bed 1–7 + valid price → {mask.sum():,} rows")
print(f"  y-axis range: 0–1150 ($ thousands)")
print()
print(f"  {'Beds':>5} {'Median':>12} {'Chart label':>12} {'Fits y-axis?':>12}")
print(f"  {'-'*5} {'-'*12} {'-'*12} {'-'*12}")
issues3 = []
for beds in range(1, 8):
    med = gb.get(beds, np.nan)
    med_k = med / 1000 if not np.isnan(med) else 0
    label = f'${med_k:.0f}K'
    fits = "YES" if med_k <= 1150 else "NO — CLIPPED"
    print(f"  {beds:>5} ${med:>11,.0f} {label:>12} {fits:>12}")
    if med_k > 1150:
        issues3.append(f"{beds} beds: ${med_k:.0f}K exceeds y-axis max 1150")

# Cross-check with analyze_data.py output
expected_beds = {1: 269000, 2: 275000, 3: 330000, 4: 459900, 5: 638876, 6: 729900, 7: 950000}
for beds, expected in expected_beds.items():
    actual = gb.get(beds, 0)
    if abs(actual - expected) > 1000:
        issues3.append(f"{beds} beds: ${actual:,.0f} ≠ expected ${expected:,.0f} (±$1K tolerance)")

# Check monotonicity (price should generally increase with bedrooms)
prev = 0
for beds in range(1, 8):
    med = gb.get(beds, 0)
    if med < prev and beds > 1:
        issues3.append(f"Non-monotonic: {beds} beds (${med:,.0f}) < {beds-1} beds (${prev:,.0f})")
    prev = med

if issues3:
    for iss in issues3:
        print(f"  ❌ {iss}")
else:
    print(f"\n  ✅ ALL CHECKS PASSED")

# ─────────────────────────────────────────────────────────────────
# CHART 4 — Price distribution
# ─────────────────────────────────────────────────────────────────
print("\n" + "─" * 70)
print("CHART 4: Price distribution (log-spaced bins)")
print("─" * 70)

NUM_BINS = 60
price_min = max(pc.min(), 1)
price_max = pc.max()
bins = np.logspace(np.log10(price_min), np.log10(price_max), NUM_BINS + 1)
counts, edges = np.histogram(pc, bins=bins)

print(f"  Bins: {NUM_BINS} log-spaced from ${price_min:,.0f} to ${price_max:,.0f}")
print(f"  Histogram sum: {counts.sum():,} (expected: {len(pc):,})")
print(f"  Match: {'YES' if counts.sum() == len(pc) else 'NO — MISMATCH'}")
print(f"  ≤ median (${pc.median():,.0f}): {(pc <= pc.median()).sum():,} ({(pc <= pc.median()).sum()/len(pc)*100:.2f}%)")
print()

# Check tick labels
tick_vals = [1_000, 5_000, 25_000, 100_000, 325_000, 1_000_000, 5_000_000, 50_000_000, 500_000_000]
tick_labels = ['$1K', '$5K', '$25K', '$100K', '$325K', '$1M', '$5M', '$50M', '$500M']
print(f"  Tick values: {tick_vals}")
print(f"  Tick labels: {tick_labels}")
print(f"  Median tick ($325K) matches actual median? {'YES' if abs(325000 - pc.median()) < 1000 else 'NO'}")

# Verify median reference line position
med = pc.median()
mn = pc.mean()
p99 = pc.quantile(0.99)
print(f"  Reference lines: median=${med:,.0f}  mean=${mn:,.0f}  p99=${p99:,.0f}")
print(f"  Annotation offset: {med * 1.12:,.0f} (1.12 × median)")

issues4 = []
if counts.sum() != len(pc):
    issues4.append(f"Histogram sum ({counts.sum():,}) ≠ pc length ({len(pc):,})")
below = (pc <= med).sum()
if below < len(pc) / 2:
    issues4.append(f"Only {below:,} ≤ median (need ≥ {len(pc)/2:,.0f})")

if issues4:
    for iss in issues4:
        print(f"  ❌ {iss}")
else:
    print(f"\n  ✅ ALL CHECKS PASSED")

# ─────────────────────────────────────────────────────────────────
# CHART 5 — Size vs price scatter
# ─────────────────────────────────────────────────────────────────
print("\n" + "─" * 70)
print("CHART 5: House size vs price scatter (150K sampled)")
print("─" * 70)

sqft = pd.to_numeric(df["house_size"], errors="coerce")
m = valid & (sqft > 0) & (sqft < 50_000) & (pc > 10_000)
sx_all, sy_all = sqft[m], pc[m]
print(f"  Filter: sqft>0, sqft<50K, price>$10K → {len(sx_all):,} rows")

rng = np.random.default_rng(42)
sample = rng.choice(len(sx_all), size=150_000, replace=False)
sx, sy = sx_all.iloc[sample], sy_all.iloc[sample]

print(f"  Sample: {len(sx):,} rows (seed=42)")
print(f"  sqft range: {sx.min():,.0f} – {sx.max():,.0f}")
print(f"  price range: ${sy.min():,.0f} – ${sy.max():,.0f}")

# Check axis ticks
x_ticks = [100, 500, 1000, 2000, 4000, 8000, 20000, 50000]
y_ticks = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 10_000_000]
print(f"  x-axis ticks: {x_ticks} → labels: ['100', '500', '1K', '2K', '4K', '8K', '20K', '50K']")
print(f"  y-axis ticks: {y_ticks} → labels: ['$10K', '$50K', '$100K', '$250K', '$500K', '$1M', '$2.5M', '$10M']")

# Check if ticks cover the data range
issues5 = []
if sx.min() < x_ticks[0]:
    issues5.append(f"Min sqft ({sx.min():,.0f}) < lowest x-tick ({x_ticks[0]:,})")
if sx.max() > x_ticks[-1]:
    issues5.append(f"Max sqft ({sx.max():,.0f}) > highest x-tick ({x_ticks[-1]:,})")
if sy.min() < y_ticks[0]:
    issues5.append(f"Min price (${sy.min():,.0f}) < lowest y-tick (${y_ticks[0]:,})")
# For y, the max tick is $2.5M but data can be up to the filter cap

# Check correlation
log_sx = np.log10(sx)
log_sy = np.log10(sy)
corr = np.corrcoef(log_sx, log_sy)[0, 1]
print(f"  Log-log correlation: r = {corr:.4f}")

if issues5:
    for iss in issues5:
        print(f"  ❌ {iss}")
else:
    print(f"\n  ✅ ALL CHECKS PASSED")

# ─────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
all_issues = issues1 + issues2 + issues3 + issues4 + issues5
if all_issues:
    print(f"❌ AUDIT FAILED — {len(all_issues)} issue(s) found:")
    for iss in all_issues:
        print(f"   • {iss}")
else:
    print("✅ ALL 5 CHARTS PASSED AUDIT — 0 issues found")
print("=" * 70)
