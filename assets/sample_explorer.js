(function (global) {
  "use strict";

  const PAGE_SIZE = 25;
  const BOUNDS = [0, 100000, 200000, 300000, 500000, 750000, 1000000, 2000000, Infinity];
  const LABELS = ["<$100k", "$100–200k", "$200–300k", "$300–500k", "$500–750k", "$750k–1m", "$1–2m", "$2m+"];

  function validPrice(row) {
    return Number.isFinite(row.price) && row.price > 0 && row.price < 5000000000;
  }

  function median(values) {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  }

  function numeric(params, key) {
    const raw = (params.get(key) || "").trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key} value`);
    return value;
  }

  function topCounts(rows, key) {
    const counts = new Map();
    for (const row of rows) {
      const name = row[key];
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  class SampleExplorer {
    constructor(payload) {
      if (!payload || !Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
        throw new Error("Sample data has an invalid format");
      }
      this.rows = payload.rows.map((values) =>
        Object.fromEntries(payload.columns.map((name, index) => [name, values[index]])),
      );
      this.sourceTotal = payload.source_total;
      this.states = topCounts(this.rows, "state").map(([name]) => name);
      this.statuses = topCounts(this.rows, "status").map(([name]) => name);
    }

    meta() {
      return { total: this.rows.length, source_total: this.sourceTotal,
        states: this.states, statuses: this.statuses };
    }

    explore(params) {
      const state = (params.get("state") || "").trim();
      const status = (params.get("status") || "").trim();
      const city = (params.get("city") || "").trim().toLocaleLowerCase();
      const cityExact = params.get("city_exact") === "1";
      const minPrice = numeric(params, "min_price");
      const maxPrice = numeric(params, "max_price");
      const minBeds = numeric(params, "min_beds");
      const minBaths = numeric(params, "min_baths");
      const minSize = numeric(params, "min_size");
      const maxSize = numeric(params, "max_size");
      const sort = params.get("sort") || "source";
      if (!["source", "price_asc", "price_desc"].includes(sort)) throw new Error("Invalid sort order");
      const page = Number(params.get("page") || 0);
      if (!Number.isInteger(page) || page < 0) throw new Error("Invalid page");

      const matches = this.rows.filter((row) => {
        if (state && row.state !== state) return false;
        if (status && row.status !== status) return false;
        if (city) {
          const rowCity = (row.city || "").toLocaleLowerCase();
          if (cityExact ? rowCity !== city : !rowCity.includes(city)) return false;
        }
        if (minPrice != null && (!validPrice(row) || row.price < minPrice)) return false;
        if (maxPrice != null && (!validPrice(row) || row.price > maxPrice)) return false;
        if (minBeds != null && (!Number.isFinite(row.bed) || row.bed < minBeds || row.bed > 20)) return false;
        if (minBaths != null && (!Number.isFinite(row.bath) || row.bath < minBaths || row.bath > 20)) return false;
        if (minSize != null && (!Number.isFinite(row.house_size) || row.house_size < minSize || row.house_size > 50000)) return false;
        if (maxSize != null && (!Number.isFinite(row.house_size) || row.house_size > maxSize || row.house_size <= 0)) return false;
        return true;
      });

      const priced = matches.filter(validPrice);
      const ppsf = matches.filter((row) => {
        const value = row.price / row.house_size;
        return validPrice(row) && Number.isFinite(value) && value > 1 && value < 5000;
      }).map((row) => row.price / row.house_size);
      const histogram = LABELS.map((label) => ({ label, count: 0 }));
      for (const row of priced) {
        for (let i = 0; i < histogram.length; i++) {
          if (row.price >= BOUNDS[i] && row.price < BOUNDS[i + 1]) {
            histogram[i].count++;
            break;
          }
        }
      }

      const locationType = state ? "city" : "state";
      const locations = topCounts(matches, locationType).slice(0, 8)
        .map(([name, count]) => ({ name, count }));
      const statusCounts = new Map(topCounts(matches, "status"));
      const statuses = this.statuses.map((name) => ({ name, count: statusCounts.get(name) || 0 }));

      if (sort !== "source") {
        matches.sort((a, b) => {
          const aValid = validPrice(a);
          const bValid = validPrice(b);
          if (!aValid && !bValid) return a.id - b.id;
          if (!aValid) return 1;
          if (!bValid) return -1;
          return (sort === "price_asc" ? a.price - b.price : b.price - a.price) || a.id - b.id;
        });
      }
      return {
        matched: matches.length,
        priced: priced.length,
        median_price: median(priced.map((row) => row.price)),
        median_ppsf: median(ppsf),
        price_distribution: histogram,
        locations, location_type: locationType, statuses,
        listings: matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        page, page_size: PAGE_SIZE,
      };
    }
  }

  global.SampleExplorer = SampleExplorer;
})(window);
