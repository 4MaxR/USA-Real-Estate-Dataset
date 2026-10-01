/**
 * USA Real Estate dashboard — renders assets/analysis.json (written by
 * scripts/analyze_data.py). The geography filter scopes the "Market view";
 * the dataset-wide section always shows all records.
 */
(function () {
  'use strict';

  var C = window.ReCharts;
  var money = C.money;
  var int = new Intl.NumberFormat('en-US');
  var $ = function (id) { return document.getElementById(id); };
  var D = null;
  var geo = 'All';
  var figures = {};
  var refocusState = false;

  /* ── formatting ─────────────────────────────────── */
  function pct(value, digits) {
    return value.toFixed(digits == null ? 1 : digits).replace(/\.0$/, '') + '%';
  }
  function share(part, whole) {
    return pct((100 * part) / whole, (100 * part) / whole < 10 ? 1 : 0);
  }
  function signed(ratio) {
    var v = Math.round((ratio - 1) * 100);
    return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + '%';
  }
  function segment() { return D.segments[geo]; }
  function national() { return D.segments.All; }
  function place() { return geo === 'All' ? 'the US' : geo; }

  /* ── captions (built with textContent; data never becomes markup) ── */
  function caption(fig, parts) {
    var node = fig.querySelector('figcaption');
    node.textContent = '';
    parts.forEach(function (part) {
      if (typeof part === 'string') {
        node.appendChild(document.createTextNode(part));
      } else {
        var b = document.createElement('strong');
        b.textContent = part.b;
        node.appendChild(b);
      }
    });
  }

  /* ── figure: chart + table twin + caption ───────── */
  function figure(id, draw, tableData, describe) {
    var fig = $(id);
    var chartEl = fig.querySelector('.chart');
    var tableEl = fig.querySelector('.table-wrap');
    var toggle = fig.querySelector('.table-toggle');
    var view = C.responsive(chartEl, function () { return draw(chartEl); });
    function drawTable() {
      var t = tableData();
      C.table(tableEl, t.columns, t.rows);
    }
    toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(on));
      tableEl.hidden = !on;
      if (on) drawTable();
    });
    function update() {
      view.redraw();
      if (!tableEl.hidden) drawTable();
      if (describe) caption(fig, describe());
    }
    update();
    return { update: update, view: view };
  }

  /* ── KPI tiles ──────────────────────────────────── */
  function renderKpis() {
    var s = segment();
    var us = national();
    var gap = (100 * (s.mean_price / s.median_price - 1));
    $('k-records').textContent = int.format(s.records);
    $('k-records-foot').textContent = geo === 'All'
      ? int.format(s.priced) + ' with a usable price'
      : int.format(s.priced) + ' priced · ' + share(s.records, us.records) + ' of all records';
    $('k-price').textContent = money(s.median_price);
    $('k-price-foot').textContent = 'Mean ' + money(s.mean_price) + ', ' + pct(gap, 0) + ' higher' +
      (geo === 'All' ? '' : ' · ' + signed(s.median_price / us.median_price) + ' vs US');
    $('k-pps').textContent = s.median_pps == null ? '—' : '$' + int.format(s.median_pps);
    $('k-pps-foot').textContent = int.format(s.pps_records) + ' records with price and size' +
      (geo === 'All' || s.median_pps == null ? '' : ' · ' + signed(s.median_pps / us.median_pps) + ' vs US');

    var parts = [
      ['For sale', s.status.for_sale, 'viz-s1'],
      ['Sold', s.status.sold, 'viz-s2'],
      ['Ready to build', s.status.ready_to_build, 'viz-deemph']
    ];
    var meter = $('k-meter');
    var legend = $('k-status');
    meter.textContent = '';
    legend.textContent = '';
    parts.forEach(function (p) {
      if (p[1] > 0) {
        var bar = document.createElement('span');
        bar.className = p[2];
        bar.style.flex = String(p[1]);
        meter.appendChild(bar);
      }
      var li = document.createElement('li');
      var sw = document.createElement('i');
      sw.className = 'swatch ' + p[2];
      li.appendChild(sw);
      li.appendChild(document.createTextNode(p[0] + ' ' + share(p[1], s.records)));
      legend.appendChild(li);
    });
  }

  /* ── charts ─────────────────────────────────────── */
  function histogram() {
    var edges = D.hist_edges;
    var at = function (price) { return (Math.log10(price) - 4) * 8; };
    var ticks = [1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7];
    return figure('fig-hist', function (el) {
      var s = segment();
      var narrow = el.clientWidth < 480;
      return C.columns(el, {
        categories: edges.slice(0, -1).map(String),
        series: [{ name: 'Records', cls: 'viz-s1' }],
        values: [s.hist],
        contiguous: true,
        height: 270,
        xTicks: ticks.filter(function (t) { return !narrow || Math.log10(t) % 1 === 0; })
          .map(function (t) { return { at: at(t), label: money(t) }; }),
        refs: [
          { at: at(s.median_price), label: 'Median ' + money(s.median_price), side: 'left' },
          { at: at(s.mean_price), label: 'Mean ' + money(s.mean_price), side: 'right' }
        ],
        ariaLabel: 'Histogram of prices in ' + place() + '. Median ' + money(s.median_price) +
          ', mean ' + money(s.mean_price) + '. Use arrow keys to read each band.',
        tip: function (i) {
          return {
            title: money(edges[i]) + ' – ' + money(edges[i + 1]),
            rows: [
              { value: int.format(s.hist[i]), name: 'records' },
              { value: share(s.hist[i], s.priced), name: 'of priced records' }
            ]
          };
        }
      });
    }, function () {
      var s = segment();
      return {
        columns: ['Price band', 'Records', 'Share'],
        rows: s.hist.map(function (count, i) {
          return [money(edges[i]) + ' – ' + money(edges[i + 1]), int.format(count), share(count, s.priced)];
        }).concat([
          ['Under ' + money(edges[0]), int.format(s.hist_below), share(s.hist_below, s.priced)],
          [money(edges[edges.length - 1]) + ' and up', int.format(s.hist_above), share(s.hist_above, s.priced)]
        ])
      };
    }, function () {
      var s = segment();
      var gap = 100 * (s.mean_price / s.median_price - 1);
      return [
        'Half of priced records in ' + place() + ' sit below ', { b: money(s.median_price) },
        '. The mean, ' + money(s.mean_price) + ', is ', { b: pct(gap, 0) + ' higher' },
        ' — a long tail of expensive homes pulls it up, so this dashboard uses medians throughout. ' +
        int.format(s.hist_below) + ' records under $10K and ' + int.format(s.hist_above) +
        ' above ' + money(edges[edges.length - 1]) + ' fall outside the axis.'
      ];
    });
  }

  function lastIndex(values) {
    for (var i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
    return -1;
  }

  function ppsBySize() {
    var bands = D.size_bands;
    function medians() { return segment().pps_by_size.map(function (b) { return b.median; }); }
    function minIndex(values) {
      var best = -1;
      values.forEach(function (v, i) { if (v != null && (best < 0 || v < values[best])) best = i; });
      return best;
    }
    // the priciest band among homes larger than the cheapest band
    function peakAfter(values, lo) {
      var best = -1;
      for (var i = lo + 1; i < values.length; i++) {
        if (values[i] != null && (best < 0 || values[i] > values[best])) best = i;
      }
      return best;
    }
    return figure('fig-pps', function (el) {
      var s = segment();
      var values = medians();
      var lo = minIndex(values);
      var hi = peakAfter(values, lo);
      return C.columns(el, {
        categories: bands,
        series: [{ name: 'Median $/sq ft', cls: 'viz-s1' }],
        values: [values],
        height: 240,
        yFormat: function (v) { return '$' + v; },
        labels: function (si, ci) {
          return (ci === lo || ci === 0 || ci === hi) && values[ci] != null ? '$' + values[ci] : null;
        },
        ariaLabel: 'Median price per square foot by house size band in ' + place() + '.',
        tip: function (i) {
          var b = s.pps_by_size[i];
          return {
            title: bands[i] + ' sq ft',
            rows: b.median == null
              ? [{ value: 'Too few records', name: '(' + b.n + ')' }]
              : [{ value: '$' + b.median, name: 'median per sq ft' }, { value: int.format(b.n), name: 'records' }]
          };
        }
      });
    }, function () {
      return {
        columns: ['House size (sq ft)', 'Median $/sq ft', 'Records'],
        rows: segment().pps_by_size.map(function (b, i) {
          return [bands[i], b.median == null ? null : '$' + b.median, int.format(b.n)];
        })
      };
    }, function () {
      var values = medians();
      var lo = minIndex(values);
      var hi = peakAfter(values, lo);
      var last = lastIndex(values);
      if (lo < 0) return ['Too few records with house size to show this breakdown.'];
      var first = values[0];
      if (first != null && lo > 0 && hi > lo && values[hi] > values[lo] * 1.05) {
        return [
          { b: 'U-shaped, not a steady decline. ' },
          'Homes under 1,000 sq ft cost $' + first + '/sq ft, the cheapest band is ' + bands[lo] +
          ' sq ft at $' + values[lo] + ', and it climbs back to $' + values[hi] + ' at ' + bands[hi] +
          ' sq ft. Mid-size homes are the best value per foot; big homes are not a bargain.'
        ];
      }
      return [
        'Price per sq ft runs from $' + (first == null ? '—' : first) + ' for the smallest homes to $' +
        values[last] + ' for the largest; the lowest band is ' + bands[lo] + ' sq ft at $' + values[lo] + '.'
      ];
    });
  }

  function beds() {
    var labels = D.bed_labels;
    function medians() { return segment().price_by_bed.map(function (b) { return b.median; }); }
    return figure('fig-beds', function (el) {
      var s = segment();
      var values = medians();
      var peak = values.indexOf(Math.max.apply(null, values.filter(function (v) { return v != null; })));
      return C.columns(el, {
        categories: labels,
        series: [{ name: 'Median price', cls: 'viz-s1' }],
        values: [values],
        height: 230,
        yFormat: money,
        labels: function (si, ci) { return (ci === 0 || ci === peak) && values[ci] != null ? money(values[ci]) : null; },
        ariaLabel: 'Median price by bedroom count in ' + place() + '.',
        tip: function (i) {
          var b = s.price_by_bed[i];
          return {
            title: labels[i] + (labels[i] === '1' ? ' bedroom' : ' bedrooms'),
            rows: b.median == null
              ? [{ value: 'Too few records', name: '(' + b.n + ')' }]
              : [{ value: money(b.median), name: 'median price' }, { value: int.format(b.n), name: 'records' }]
          };
        }
      });
    }, function () {
      return {
        columns: ['Bedrooms', 'Median price', 'Records'],
        rows: segment().price_by_bed.map(function (b, i) {
          return [labels[i], b.median == null ? null : money(b.median), int.format(b.n)];
        })
      };
    }, function () {
      var values = medians();
      var after = D.drivers.factors.filter(function (f) { return f.factor === 'Bedrooms'; })[0].after_size_pct;
      var parts = ['Bedrooms mostly restate house size: once size is known they explain just ',
        { b: pct(after) }, ' of the remaining price variation nationwide.'];
      for (var i = 1; i < values.length; i++) {
        if (values[i] != null && values[i - 1] != null && values[i] < values[i - 1]) {
          parts.push(' The ladder isn’t smooth either — ' + labels[i] + '-bedroom records (' + money(values[i]) +
            ') price below ' + labels[i - 1] + '-bedroom ones (' + money(values[i - 1]) + ').');
          break;
        }
      }
      return parts;
    });
  }

  function statusByBed() {
    var labels = D.status_bed_labels;
    return figure('fig-status', function (el) {
      var s = segment();
      return C.columns(el, {
        categories: labels,
        series: [{ name: 'For sale', cls: 'viz-s1' }, { name: 'Sold', cls: 'viz-s2' }],
        values: [s.status_by_bed.for_sale, s.status_by_bed.sold],
        height: 230,
        yFormat: money,
        ariaLabel: 'Median price of for-sale and sold records by bedroom count in ' + place() + '.',
        tip: function (i) {
          var fs = s.status_by_bed.for_sale[i];
          var so = s.status_by_bed.sold[i];
          var rows = [
            { value: money(fs), name: 'for sale', cls: 'viz-s1' },
            { value: money(so), name: 'sold', cls: 'viz-s2' }
          ];
          if (fs != null && so != null) rows.push({ value: signed(so / fs), name: 'sold vs for sale' });
          return { title: labels[i] + (labels[i] === '1' ? ' bedroom' : ' bedrooms'), rows: rows };
        }
      });
    }, function () {
      var s = segment();
      return {
        columns: ['Bedrooms', 'For sale', 'Sold'],
        rows: labels.map(function (l, i) {
          return [l, money(s.status_by_bed.for_sale[i]), money(s.status_by_bed.sold[i])];
        }).concat([['All records', money(s.status_median.for_sale), money(s.status_median.sold)]])
      };
    }, function () {
      var s = segment();
      var fs = s.status_by_bed.for_sale;
      var so = s.status_by_bed.sold;
      var pairs = 0;
      var lower = 0;
      fs.forEach(function (v, i) {
        if (v != null && so[i] != null) { pairs++; if (so[i] < v) lower++; }
      });
      var all = s.status_median;
      if (!pairs || all.sold == null || all.for_sale == null) return ['Too few sold or for-sale records to compare here.'];
      if (all.sold > all.for_sale && lower * 2 === pairs) {
        return ['Overall, sold records have the higher median (' + money(all.sold) + ' vs ' + money(all.for_sale) +
          '), but bedroom by bedroom it is a split — sold is ', { b: 'lower at ' + lower + ' of ' + pairs },
          ' counts. Compare like with like before reading this as a sold premium.'];
      }
      if (all.sold > all.for_sale && lower * 2 > pairs) {
        var parts = ['Overall, sold records have the higher median (' + money(all.sold) + ' vs ' +
          money(all.for_sale) + ') — yet sold is ', { b: 'lower at ' + lower + ' of ' + pairs + ' bedroom counts' },
          '. The overall gap comes from which homes sold, not from sale prices running higher.'];
        if (geo === 'All') {
          var m = D.status_mix;
          parts.push(' California is ' + pct(m.california_share_sold_pct) + ' of sold records but ' +
            pct(m.california_share_for_sale_pct) + ' of for-sale ones; weighted to the for-sale state mix, the sold median is ' +
            money(m.sold_median_state_mix) + '.');
        }
        return parts;
      }
      return ['Sold is below for-sale at ', { b: lower + ' of ' + pairs + ' bedroom counts' },
        ' (all records: sold ' + money(all.sold) + ', for sale ' + money(all.for_sale) + ').'];
    });
  }

  function rankedStates() {
    return Object.keys(D.segments)
      .filter(function (k) { return k !== 'All' && D.segments[k].records >= D.bounds.min_state_records; })
      .sort(function (a, b) { return D.segments[b].median_price - D.segments[a].median_price; });
  }

  function states() {
    var names = rankedStates();
    return figure('fig-states', function (el) {
      var values = names.map(function (n) { return D.segments[n].median_price; });
      var selected = names.indexOf(geo);
      var handle = C.hbars(el, {
        categories: names,
        series: [{ name: 'Median price', cls: 'viz-s1' }],
        values: [values],
        thickness: 10,
        rowHeight: 17,
        xFormat: money,
        emphasis: selected >= 0 ? selected : null,
        markClass: function (si, ci) { return geo === 'All' || ci === selected ? 'viz-s1' : 'viz-deemph'; },
        labels: function (si, ci) {
          if (selected >= 0) return ci === selected ? money(values[ci]) : null;
          return ci === 0 || ci === names.length - 1 ? money(values[ci]) : null;
        },
        refs: [{ value: national().median_price, label: 'US ' + money(national().median_price) }],
        ariaLabel: 'Median price for ' + names.length + ' states and territories, highest first. ' +
          'Use arrow keys to read, Enter to filter the dashboard to a state.',
        tip: function (i) {
          var s = D.segments[names[i]];
          return {
            title: '#' + (i + 1) + ' ' + names[i],
            rows: [
              { value: money(s.median_price), name: 'median price' },
              { value: int.format(s.records), name: 'records' },
              { value: names[i] === geo ? 'Selected' : 'Select to filter', name: '' }
            ]
          };
        },
        onSelect: function (i) {
          refocusState = document.activeElement && document.activeElement.closest &&
            !!document.activeElement.closest('#fig-states');
          setGeo(names[i] === geo ? 'All' : names[i]);
        }
      });
      if (refocusState && selected >= 0) {
        refocusState = false;
        handle.focus(selected);
      }
      return handle;
    }, function () {
      return {
        columns: ['Rank · state', 'Median price', 'Median $/sq ft', 'Records'],
        rows: names.map(function (n, i) {
          var s = D.segments[n];
          return [(i + 1) + '. ' + n, money(s.median_price), s.median_pps == null ? null : '$' + s.median_pps,
            int.format(s.records)];
        })
      };
    }, function () {
      var top = D.segments[names[0]];
      var bottom = D.segments[names[names.length - 1]];
      var rank = names.indexOf(geo);
      if (geo === 'All') {
        return [names[0] + ' has the highest median (' + money(top.median_price) + ') and ' +
          names[names.length - 1] + ' the lowest (' + money(bottom.median_price) + '): a ',
          { b: (top.median_price / bottom.median_price).toFixed(1) + '× spread' },
          '. Record counts track population — ' + D.coverage.top3.join(', ') + ' hold ' +
          pct(D.coverage.top3_share_pct) + ' — so volume here measures coverage, not demand.'];
      }
      if (rank < 0) return [geo + ' has fewer than 1,000 records, so it is not ranked.'];
      return [geo + ' ranks ', { b: '#' + (rank + 1) + ' of ' + names.length },
        ' at ' + money(D.segments[geo].median_price) + ', ' +
        signed(D.segments[geo].median_price / national().median_price) + ' vs the US median.'];
    });
  }

  function drivers() {
    var f = D.drivers.factors;
    figure('fig-drivers', function (el) {
      return C.hbars(el, {
        categories: f.map(function (d) { return d.factor; }),
        series: [{ name: 'On its own', cls: 'viz-s1' }, { name: 'Of what size leaves', cls: 'viz-s2' }],
        values: [f.map(function (d) { return d.explained_pct; }), f.map(function (d) { return d.after_size_pct; })],
        xFormat: function (v) { return v + '%'; },
        labels: function (si, ci) {
          var v = si === 0 ? f[ci].explained_pct : f[ci].after_size_pct;
          return v == null ? null : pct(v);
        },
        ariaLabel: 'Share of variation in log price explained by ZIP code, city, house size, state and bedrooms.',
        tip: function (i) {
          var rows = [{ value: pct(f[i].explained_pct), name: 'of all variation', cls: 'viz-s1' }];
          if (f[i].after_size_pct != null) {
            rows.push({ value: pct(f[i].after_size_pct), name: 'of what size leaves', cls: 'viz-s2' });
          }
          rows.push({ value: int.format(f[i].groups), name: 'groups' });
          return { title: f[i].factor, rows: rows };
        }
      });
    }, function () {
      return {
        columns: ['Factor', 'On its own', 'Of what size leaves', 'Groups'],
        rows: f.map(function (d) {
          return [d.factor, pct(d.explained_pct), d.after_size_pct == null ? null : pct(d.after_size_pct),
            int.format(d.groups)];
        })
      };
    }, function () {
      var by = {};
      f.forEach(function (d) { by[d.factor] = d; });
      return ['ZIP code alone explains ', { b: pct(by['ZIP code'].explained_pct) },
        ' of the variation in log price, house size ' + pct(by['House size'].explained_pct) + ', state ' +
        pct(by.State.explained_pct) + ' and bedrooms ' + pct(by.Bedrooms.explained_pct) +
        '. Once size is accounted for, bedrooms explain just ', { b: pct(by.Bedrooms.after_size_pct) },
        ' of what is left while ZIP explains ' + pct(by['ZIP code'].after_size_pct) +
        ': local location and size set the price.'];
    });
  }

  function missing() {
    var cols = Object.keys(D.missing_pct).sort(function (a, b) { return D.missing_pct[b] - D.missing_pct[a]; });
    figure('fig-missing', function (el) {
      return C.hbars(el, {
        categories: cols,
        series: [{ name: 'Missing', cls: 'viz-s1' }],
        values: [cols.map(function (c) { return D.missing_pct[c]; })],
        thickness: 10,
        rowHeight: 20,
        xFormat: function (v) { return v + '%'; },
        labels: function (si, ci) { var v = D.missing_pct[cols[ci]]; return v >= 1 ? pct(v) : null; },
        ariaLabel: 'Percent of records missing each column.',
        tip: function (i) {
          var v = D.missing_pct[cols[i]];
          return {
            title: cols[i],
            rows: [
              { value: pct(v, 2), name: 'missing' },
              { value: int.format(Math.round((v / 100) * D.kpi.records)), name: 'records (approx.)' }
            ]
          };
        }
      });
    }, function () {
      return { columns: ['Column', 'Missing'], rows: cols.map(function (c) { return [c, pct(D.missing_pct[c], 2)]; }) };
    }, function () {
      var q = D.quality;
      return ['A quarter of records lack house size and about a fifth lack bedrooms or bathrooms. prev_sold_date is blank for a third — but ',
        { b: 'every sold record has one' }, ', all between ' + monthYear(q.sold_window[0]) + ' and ' +
        monthYear(q.sold_window[1]) + '.'];
    });
  }

  function monthYear(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }

  function issues() {
    var q = D.quality;
    var cov = D.coverage;
    var cards = [
      ['Repeat records', int.format(q.repeat_extra_records) + ' (' + pct(q.repeat_extra_pct) + ')',
        'Records sharing an encoded street, ZIP, beds, baths, size and lot. ' + pct(q.repeat_forsale_and_sold_pct, 0) +
        ' are one home listed as both for sale and sold, almost always at the same price. The file has ' +
        int.format(q.exact_duplicates) + ' exact duplicates only because broker or status differ.'],
      ['Street is a key, not junk', int.format(q.street_ids) + ' IDs',
        'Numeric street IDs map to a single ZIP code ' + pct(q.street_single_zip_pct) +
        ' of the time — an encoded address. It cannot be mapped, but it can match records of the same home.'],
      ['Placeholder prices', int.format(q.price_under_1000 + q.price_over_1b) + ' records',
        int.format(q.price_under_1000) + ' under $1,000 (' + int.format(q.price_zero) + ' at $0) and ' +
        int.format(q.price_over_1b) + ' at $1B or more, including ' + int.format(q.price_max) +
        ' — an int32 overflow. Excluded from price metrics only.'],
      ['Impossible sizes', int.format(q.size_over_50k + q.bed_over_20 + q.bath_over_20) + ' values',
        int.format(q.size_over_50k) + ' house sizes over 50,000 sq ft (max ' + int.format(q.size_max) + '), ' +
        int.format(q.bed_over_20) + ' bedroom and ' + int.format(q.bath_over_20) + ' bathroom counts over 20 (max ' +
        q.bed_max + ' and ' + q.bath_max + ').'],
      ['Not 55 states', cov.us_states + ' + ' + (cov.values - cov.us_states),
        'The state column has ' + cov.values + ' values: ' + cov.us_states + ' states, ' +
        cov.dc_and_territories.join(', ') + ' — and ' + cov.foreign['New Brunswick'] + ' record from New Brunswick, Canada.'],
      ['Two time frames', monthYear(q.sold_window[0]) + ' – ' + monthYear(q.sold_window[1]),
        'Every sold record carries a sale date in this window; for-sale prices are asking prices at scrape time. Sold and for-sale medians describe different moments.']
    ];
    var host = $('issues');
    host.textContent = '';
    cards.forEach(function (c) {
      var card = document.createElement('article');
      card.className = 'issue';
      var small = document.createElement('small');
      small.textContent = c[0];
      var strong = document.createElement('strong');
      strong.textContent = c[1];
      var p = document.createElement('p');
      p.textContent = c[2];
      card.appendChild(small);
      card.appendChild(strong);
      card.appendChild(p);
      host.appendChild(card);
    });
  }

  function method() {
    var b = D.bounds;
    var items = [
      'Validity windows, applied per metric (a record failing one is excluded from that metric only): price ' +
        money(b.price[0]) + ' to under ' + money(b.price[1]) + '; house size ' + int.format(b.house_size[0]) + '–' +
        int.format(b.house_size[1]) + ' sq ft; bedrooms ' + b.bed[0] + '–' + b.bed[1] + '; price per sq ft $' +
        b.price_per_sqft[0] + '–$' + int.format(b.price_per_sqft[1]) + '.',
      'Medians throughout. A median needs at least ' + b.min_cell + ' records to be shown; a state needs ' +
        int.format(b.min_state_records) + ' records to be ranked.',
      '“What explains price” is adjusted η²: the share of variance in log price explained by group means, adjusted for the number of groups, on ' +
        int.format(D.drivers.sample) + ' records with valid price, size and bedrooms. House size uses 20 equal-count bands; the second bar applies the same measure to what those bands leave unexplained.',
      'Price grows almost in proportion to size: a log–log fit gives an elasticity of ' + D.drivers.size_elasticity +
        ', so a 10% larger home is priced about ' + pct(D.drivers.size_elasticity * 10) + ' higher on average.',
      'Repeat records share street ID, ZIP code, beds, baths, house size and lot size. Headline medians barely move without them, so all records are kept and the issue is reported.',
      'Generated ' + D.generated + ' from ' + D.source + '.'
    ];
    var list = $('method');
    list.textContent = '';
    items.forEach(function (text) {
      var li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }

  /* ── geography filter ───────────────────────────── */
  function setGeo(name, skipHash) {
    geo = D.segments[name] ? name : 'All';
    $('geo').value = geo;
    $('reset').hidden = geo === 'All';
    $('geo-note').textContent = geo === 'All'
      ? 'Tip: select a bar in the state ranking.'
      : (D.segments[geo].records < D.bounds.min_state_records
        ? 'Small sample — fewer than 1,000 records.'
        : 'Showing ' + int.format(D.segments[geo].records) + ' records.');
    if (!skipHash) {
      try {
        history.replaceState(null, '', geo === 'All' ? location.pathname : '#geo=' + encodeURIComponent(geo));
      } catch (e) { /* file:// or sandboxed */ }
    }
    renderKpis();
    ['hist', 'pps', 'beds', 'status', 'states'].forEach(function (k) { figures[k].update(); });
  }

  function buildSelect() {
    var select = $('geo');
    Object.keys(D.segments)
      .filter(function (k) { return k !== 'All' && D.segments[k].records >= 100; })
      .sort()
      .forEach(function (name) {
        var s = D.segments[name];
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name + ' — ' + int.format(s.records) +
          (s.records < D.bounds.min_state_records ? ' (small sample)' : '');
        select.appendChild(opt);
      });
    select.addEventListener('change', function () { setGeo(select.value); });
    $('reset').addEventListener('click', function () { setGeo('All'); select.focus(); });
  }

  /* ── theme toggle ───────────────────────────────── */
  function isDark() {
    var forced = document.documentElement.getAttribute('data-theme');
    if (forced) return forced === 'dark';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncTheme() {
    $('theme').setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  }
  $('theme').addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* storage blocked */ }
    syncTheme();
  });
  syncTheme();

  /* ── boot ───────────────────────────────────────── */
  function hashGeo() {
    return decodeURIComponent((location.hash.match(/geo=([^&]+)/) || [])[1] || '');
  }

  function boot(data) {
    D = data;
    if (D.segments[hashGeo()]) geo = hashGeo();
    window.addEventListener('hashchange', function () {
      var next = hashGeo() || 'All';
      if (next !== geo) setGeo(next, true);
    });
    buildSelect();
    $('geo').value = geo;
    renderKpis();
    figures.hist = histogram();
    figures.pps = ppsBySize();
    figures.beds = beds();
    figures.status = statusByBed();
    figures.states = states();
    drivers();
    missing();
    issues();
    method();
    setGeo(geo, true);
    $('market').classList.remove('is-loading');
  }

  function fail(message) {
    var box = $('error');
    box.textContent = message;
    box.hidden = false;
    $('market').classList.remove('is-loading');
  }

  fetch('assets/analysis.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var start = function () { boot(data); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start);
      else start();
    })
    .catch(function () {
      fail('The analysis data could not be loaded. Open this page through GitHub Pages or a local server ' +
        '(python -m http.server) — browsers block data files opened directly from disk.');
    });
})();
