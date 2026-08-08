#!/usr/bin/env python3
"""
USA Real Estate — chart generation (dark theme, portfolio design system).
Reads ../data/realtor-data.zip.csv, writes PNGs to the portfolio repo:
assets/images/usa-real-estate/

Usage:  python scripts/generate_charts.py
"""
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

BG      = '#08111f'
SURFACE = '#0f1a2e'
ACCENT  = '#6ae7c4'
ACCENT2 = '#91a8ff'
TEXT    = '#e1eaf5'
MUTED   = '#7b8ba3'
LINE    = '#1a2d47'
AMBER   = '#fdbc40'
CORAL   = '#ff7a7a'

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.size': 11,
    'axes.edgecolor': LINE,
    'axes.facecolor': BG,
    'axes.labelcolor': TEXT,
    'axes.titlecolor': TEXT,
    'figure.facecolor': BG,
    'grid.color': LINE,
    'grid.alpha': 0.4,
    'text.color': TEXT,
    'xtick.color': MUTED,
    'ytick.color': MUTED,
    'legend.facecolor': SURFACE,
    'legend.edgecolor': LINE,
    'legend.labelcolor': TEXT,
})

DATA = Path(__file__).resolve().parent.parent / "data" / "realtor-data.zip.csv"
OUT = Path(r"D:\Desktop\portfolio-website\assets\images\usa-real-estate")
OUT.mkdir(parents=True, exist_ok=True)

def save(fig, name):
    fig.savefig(OUT / name, dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close(fig)
    print("saved", name)

def tidy(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    return ax

print("loading...")
df = pd.read_csv(DATA, low_memory=False)
price = pd.to_numeric(df["price"], errors="coerce")
valid = (price > 0) & (price < 5_000_000_000)
pc = price[valid]

# ---------------- 1. Status donut ----------------
sc = df["status"].astype(str).str.strip().value_counts()
fig, ax = plt.subplots(figsize=(6.4, 4.6))
labels = ['for sale', 'sold', 'ready to build']
vals = [sc.get('for_sale', 0), sc.get('sold', 0), sc.get('ready_to_build', 0)]
colors = [ACCENT, ACCENT2, AMBER]
wedges, _ = ax.pie(vals, colors=colors, startangle=90,
                   wedgeprops=dict(width=0.42, edgecolor=BG))
total = sum(vals)
ax.text(0, 0.10, '2,226,382', ha='center', va='center', fontsize=20, fontweight=700, color=TEXT)
ax.text(0, -0.20, 'listings', ha='center', va='center', fontsize=10, color=MUTED)
ax.legend(wedges, [f'{l} — {100*v/total:.1f}%' for l, v in zip(labels, vals)],
          loc='center left', bbox_to_anchor=(0.98, 0.5), frameon=False)
ax.set_title('Listing status — USA real estate dataset', pad=12)
save(fig, 'status-donut.png')

# ---------------- 2. Median price by state (top 12 by volume) ----------------
state = df["state"].astype(str).str.strip()
g = pd.DataFrame({"state": state, "price": pc}).query("price > 0").groupby("state")["price"].agg(["count", "median"])
g = g[g.index != ""].sort_values("count", ascending=False).head(12)
fig, ax = plt.subplots(figsize=(9.6, 5.2))
y = np.arange(len(g))[::-1]
bars = ax.barh(y, g["median"] / 1000, 0.6, color=ACCENT)
tidy(ax)
for i, (idx, r) in enumerate(g.iterrows()):
    if idx == "California":
        bars[i].set_color(ACCENT2)
    ax.text(r["median"] / 1000 + 12, y[i], f'${r["median"]/1000:.0f}K', va='center', fontsize=8.5, color=MUTED)
    ax.text(-14, y[i], f'{r["count"]/1000:.0f}K', va='center', ha='right', fontsize=8, color=MUTED)
ax.set_yticks(y)
ax.set_yticklabels(g.index, fontsize=9.5)
ax.set_xlabel('Median listing price ($ thousands)')
ax.set_xlim(0, 780)
ax.set_title('Median price vs listing volume — top 12 states', pad=12)
ax.axvline(325, color=MUTED, lw=0.8, ls='--')
ax.text(325 + 8, -0.75, 'US median $325K', fontsize=8, color=MUTED)
save(fig, 'median-price-state.png')

# ---------------- 3. Median price by bedrooms ----------------
bed = pd.to_numeric(df["bed"], errors="coerce")
mask = (bed > 0) & (bed <= 7) & valid
gb = pd.DataFrame({"bed": bed[mask], "price": pc[mask]}).groupby("bed")["price"].median()
fig, ax = plt.subplots(figsize=(9.2, 4.6))
x = gb.index.astype(int)
ax.bar(x, gb.values / 1000, 0.62, color=ACCENT)
tidy(ax)
for xi, v in zip(x, gb.values / 1000):
    ax.text(xi, v + 18, f'${v:.0f}K', ha='center', fontsize=8.5, color=MUTED)
ax.set_xticks(x)
ax.set_xlabel('Bedrooms')
ax.set_ylabel('Median listing price ($ thousands)')
ax.set_ylim(0, 1150)
ax.set_title('Median price by bedroom count — 1 to 7 beds', pad=12)
save(fig, 'price-by-bed.png')

# ---------------- 4. Price distribution (log scale) ----------------
cap = pc[pc < pc.quantile(0.99)]
fig, ax = plt.subplots(figsize=(9.6, 4.6))
ax.hist(cap, bins=80, color=ACCENT, alpha=0.85, edgecolor=BG, log=True)
ax.axvline(cap.median(), color=AMBER, lw=1.4, ls='--')
ax.text(cap.median() * 1.06, ax.get_ylim()[1] * 0.9, f'median ${cap.median()/1000:.0f}K',
        color=AMBER, fontsize=9)
tidy(ax)
ax.set_xscale('log')
ax.set_xticks([50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000])
ax.set_xticklabels(['$50K', '$100K', '$250K', '$500K', '$1M', '$2.5M'])
ax.set_ylabel('Listings (log scale)')
ax.set_xlabel('Price')
ax.set_title('Price distribution — 2.22M listings, right-skewed', pad=12)
save(fig, 'price-distribution.png')

# ---------------- 5. House size vs price (sampled, log-log) ----------------
sqft = pd.to_numeric(df["house_size"], errors="coerce")
m = valid & (sqft > 0) & (sqft < 50_000) & (pc > 10_000)
sx_all, sy_all = sqft[m], pc[m]
rng = np.random.default_rng(42)
sample = rng.choice(len(sx_all), size=150_000, replace=False)
sx, sy = sx_all.iloc[sample], sy_all.iloc[sample]
fig, ax = plt.subplots(figsize=(9.6, 5.0))
ax.scatter(sx, sy, s=4, alpha=0.18, color=ACCENT, linewidths=0)
tidy(ax)
ax.set_xscale('log'); ax.set_yscale('log')
ax.set_xticks([500, 1000, 2000, 4000, 8000])
ax.set_xticklabels(['500', '1K', '2K', '4K', '8K'])
ax.set_yticks([50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000])
ax.set_yticklabels(['$50K', '$100K', '$250K', '$500K', '$1M', '$2.5M'])
ax.set_xlabel('House size (sq ft, log)')
ax.set_ylabel('Price (log)')
ax.set_title('Price vs house size — 150K sampled listings', pad=12)
save(fig, 'size-price-scatter.png')
