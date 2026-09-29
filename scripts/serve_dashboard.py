#!/usr/bin/env python3
"""Serve the interactive dashboard from the full local Realtor CSV.

Usage: python scripts/serve_dashboard.py [--port 8765]
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "realtor-data.zip.csv"
HTML = ROOT / "dashboard" / "index.html"
PAGE_SIZE = 25
PRICE_BINS = [0, 100_000, 200_000, 300_000, 500_000, 750_000,
              1_000_000, 2_000_000, np.inf]
PRICE_LABELS = ["<$100k", "$100–200k", "$200–300k", "$300–500k",
                "$500–750k", "$750k–1m", "$1–2m", "$2m+"]


def load_data():
    columns = ["brokered_by", "status", "price", "bed", "bath", "acre_lot",
               "city", "state", "zip_code", "house_size", "prev_sold_date"]
    frame = pd.read_csv(
        CSV,
        usecols=columns,
        dtype={"status": "category", "city": "category", "state": "category",
               "zip_code": "string", "prev_sold_date": "string",
               "brokered_by": "float64", "price": "float64", "bed": "float32",
               "bath": "float32", "acre_lot": "float32", "house_size": "float64"},
        low_memory=False,
    )
    return frame


class Explorer:
    def __init__(self, frame):
        self.df = frame
        self.price = frame["price"].to_numpy()
        self.size = frame["house_size"].to_numpy()
        self.bed = frame["bed"].to_numpy()
        self.bath = frame["bath"].to_numpy()
        self.valid_price = np.isfinite(self.price) & (self.price > 0) & (self.price < 5_000_000_000)
        with np.errstate(divide="ignore", invalid="ignore"):
            self.ppsf = self.price / self.size
        self.valid_ppsf = self.valid_price & np.isfinite(self.ppsf) & (self.ppsf > 1) & (self.ppsf < 5000)
        self.city_names = frame["city"].cat.categories.astype(str)
        self.city_folded = self.city_names.str.casefold()
        self.city_codes = frame["city"].cat.codes.to_numpy()
        states = frame["state"].value_counts()
        self.states = [str(value) for value in states.index if pd.notna(value)]
        self.statuses = [str(value) for value in frame["status"].cat.categories if pd.notna(value)]

    @staticmethod
    def number(params, key):
        raw = params.get(key, [""])[0].strip()
        if not raw:
            return None
        try:
            value = float(raw)
        except ValueError:
            raise ValueError(f"Invalid {key} value") from None
        if not np.isfinite(value) or value < 0:
            raise ValueError(f"Invalid {key} value")
        return value

    def explore(self, params):
        state = params.get("state", [""])[0].strip()
        status = params.get("status", [""])[0].strip()
        city = params.get("city", [""])[0].strip().casefold()
        city_exact = params.get("city_exact", [""])[0] == "1"
        min_price = self.number(params, "min_price")
        max_price = self.number(params, "max_price")
        min_beds = self.number(params, "min_beds")
        min_baths = self.number(params, "min_baths")
        min_size = self.number(params, "min_size")
        max_size = self.number(params, "max_size")
        sort = params.get("sort", ["source"])[0]
        if sort not in {"source", "price_asc", "price_desc"}:
            raise ValueError("Invalid sort order")
        try:
            page = int(params.get("page", ["0"])[0])
        except ValueError:
            raise ValueError("Invalid page") from None
        if page < 0:
            raise ValueError("Invalid page")

        mask = np.ones(len(self.df), dtype=bool)
        if state:
            mask &= (self.df["state"] == state).to_numpy()
        if status:
            mask &= (self.df["status"] == status).to_numpy()
        if city:
            matches = (self.city_folded == city) if city_exact else self.city_folded.str.contains(city, regex=False)
            codes = np.flatnonzero(matches)
            mask &= np.isin(self.city_codes, codes)
        if min_price is not None:
            mask &= self.valid_price & (self.price >= min_price)
        if max_price is not None:
            mask &= self.valid_price & (self.price <= max_price)
        if min_beds is not None:
            mask &= np.isfinite(self.bed) & (self.bed >= min_beds) & (self.bed <= 20)
        if min_baths is not None:
            mask &= np.isfinite(self.bath) & (self.bath >= min_baths) & (self.bath <= 20)
        if min_size is not None:
            mask &= np.isfinite(self.size) & (self.size >= min_size) & (self.size <= 50_000)
        if max_size is not None:
            mask &= np.isfinite(self.size) & (self.size <= max_size) & (self.size > 0)

        ids = np.flatnonzero(mask)
        priced = ids[self.valid_price[ids]]
        ppsf_ids = ids[self.valid_ppsf[ids]]
        median_price = float(np.median(self.price[priced])) if len(priced) else None
        median_ppsf = float(np.median(self.ppsf[ppsf_ids])) if len(ppsf_ids) else None
        histogram, _ = np.histogram(self.price[priced], bins=PRICE_BINS)
        location_col = "city" if state else "state"
        location_counts = self.df.iloc[ids][location_col].value_counts().head(8)
        locations = [{"name": str(name), "count": int(count)}
                     for name, count in location_counts.items() if pd.notna(name)]
        status_counts = self.df.iloc[ids]["status"].value_counts()
        statuses = [{"name": name, "count": int(status_counts.get(name, 0))}
                    for name in self.statuses]

        if sort != "source":
            # Unpriced rows follow priced rows for either price ordering.
            if len(priced):
                order = np.argsort(self.price[priced], kind="stable")
                if sort == "price_desc":
                    order = order[::-1]
                ids = np.concatenate((priced[order], ids[~self.valid_price[ids]]))
        start = page * PAGE_SIZE
        listing_ids = ids[start:start + PAGE_SIZE]
        listings = [self.listing(int(i)) for i in listing_ids]
        return {
            "matched": int(len(ids)), "priced": int(len(priced)),
            "median_price": median_price, "median_ppsf": median_ppsf,
            "price_distribution": [{"label": label, "count": int(count)}
                                   for label, count in zip(PRICE_LABELS, histogram)],
            "locations": locations, "location_type": location_col,
            "statuses": statuses, "listings": listings,
            "page": page, "page_size": PAGE_SIZE,
        }

    def listing(self, index):
        row = self.df.iloc[index]
        def clean(value):
            if pd.isna(value):
                return None
            if isinstance(value, (np.integer, np.floating)):
                return value.item()
            return str(value)
        return {"id": index + 1, **{key: clean(row[key]) for key in self.df.columns}}


class Handler(BaseHTTPRequestHandler):
    explorer = None

    def send_bytes(self, payload, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, data, status=200):
        self.send_bytes(json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                        "application/json; charset=utf-8", status)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in {"/", "/index.html"}:
            self.send_bytes(HTML.read_bytes(), "text/html; charset=utf-8")
        elif url.path == "/api/meta":
            self.send_json({"total": len(self.explorer.df), "states": self.explorer.states,
                            "statuses": self.explorer.statuses})
        elif url.path == "/api/explore":
            try:
                self.send_json(self.explorer.explore(parse_qs(url.query)))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, 400)
        else:
            self.send_json({"error": "Not found"}, 404)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not CSV.exists():
        parser.error(f"Dataset not found: {CSV}")
    print(f"Loading {CSV.name}...", flush=True)
    Handler.explorer = Explorer(load_data())
    print(f"Dashboard ready at http://127.0.0.1:{args.port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
