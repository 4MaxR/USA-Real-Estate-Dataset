/**
 * ReCharts — small dependency-free SVG charts (columns + horizontal bars).
 * Shared by the USA Real Estate dashboard and its portfolio case study.
 * Colors come from CSS classes (.viz-s1, .viz-s2, .viz-deemph …) so theme
 * switches restyle charts without a re-render.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var tooltip = null;
  var live = null;
  var measurer = null;

  /* ── DOM helpers ───────────────────────────────── */
  function svgEl(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    for (var key in attrs) {
      if (attrs[key] != null) node.setAttribute(key, attrs[key]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function svgText(parent, x, y, str, cls, anchor) {
    var node = svgEl('text', { x: x, y: y, 'class': cls, 'text-anchor': anchor || 'start' }, parent);
    node.textContent = str;
    return node;
  }

  function textWidth(str, cls) {
    if (!measurer) {
      measurer = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true', 'class': 'viz' });
      measurer.style.position = 'absolute';
      measurer.style.left = '-9999px';
      measurer.style.visibility = 'hidden';
      document.body.appendChild(measurer);
    }
    var node = svgText(measurer, 0, 0, str, cls);
    var width = node.getComputedTextLength();
    measurer.removeChild(node);
    return width;
  }

  /* ── number helpers ────────────────────────────── */
  function compact(value) {
    var abs = Math.abs(value);
    var units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i++) {
      // 0.9995 so that 999,500 reads "1M", never "1000K"
      if (abs >= units[i][0] * 0.9995) {
        var x = value / units[i][0];
        var s = Math.abs(x) >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '');
        return s + units[i][1];
      }
    }
    return String(Math.round(value));
  }

  function money(value) {
    if (value == null) return '—';
    return (value < 0 ? '−$' : '$') + compact(Math.abs(value));
  }

  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var r = raw / mag;
    var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    var out = [];
    for (var v = 0; v < max + step * 0.999; v += step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }

  /* ── mark geometry: 4px rounded data-end, square at the baseline ── */
  function columnPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) +
      'A' + r + ',' + r + ' 0 0 1 ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + (y + r) +
      'V' + (y + h) + 'Z';
  }

  function rowPath(x, y, w, h) {
    var r = Math.min(4, h / 2, w);
    return 'M' + x + ',' + y + 'H' + (x + w - r) +
      'A' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w - r) + ',' + (y + h) +
      'H' + x + 'Z';
  }

  /* ── tooltip (values lead, labels follow; textContent only) ── */
  function getTooltip() {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'viz-tooltip';
      tooltip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function showTip(info, clientX, clientY) {
    var tip = getTooltip();
    tip.textContent = '';
    if (info.title) {
      var head = document.createElement('div');
      head.className = 'viz-tooltip-title';
      head.textContent = info.title;
      tip.appendChild(head);
    }
    info.rows.forEach(function (row) {
      var line = document.createElement('div');
      line.className = 'viz-tooltip-row';
      if (row.cls) {
        var key = document.createElement('i');
        key.className = 'viz-key ' + row.cls;
        line.appendChild(key);
      }
      var value = document.createElement('strong');
      value.textContent = row.value;
      line.appendChild(value);
      if (row.name) {
        var name = document.createElement('span');
        name.textContent = row.name;
        line.appendChild(name);
      }
      tip.appendChild(line);
    });
    tip.classList.add('is-visible');
    var box = tip.getBoundingClientRect();
    var pad = 12;
    var x = clientX + 14;
    var y = clientY - box.height - 12;
    if (x + box.width > window.innerWidth - pad) x = clientX - box.width - 14;
    if (x < pad) x = pad;
    if (y < pad) y = clientY + 18;
    tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function hideTip() {
    if (tooltip) tooltip.classList.remove('is-visible');
  }

  function announce(info) {
    if (!live) {
      live = document.createElement('div');
      live.className = 'viz-sr';
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = [info.title].concat(info.rows.map(function (r) {
      return (r.name ? r.name + ': ' : '') + r.value;
    })).join('. ');
  }

  /* ── hover / focus layer: hit targets bigger than marks, arrow-key nav ── */
  function bindMarks(svg, items) {
    var active = -1;

    function activate(index, evt) {
      if (active >= 0 && items[active]) {
        items[active].marks.forEach(function (m) { m.classList.remove('is-active'); });
      }
      active = index;
      if (index < 0) { hideTip(); return; }
      var item = items[index];
      item.marks.forEach(function (m) { m.classList.add('is-active'); });
      var info = item.info();
      if (evt && evt.clientX != null) {
        showTip(info, evt.clientX, evt.clientY);
      } else {
        var anchor = (item.marks[0] || item.hit).getBoundingClientRect();
        showTip(info, anchor.left + anchor.width / 2, anchor.top);
        announce(info);
      }
    }

    items.forEach(function (item, index) {
      item.hit.addEventListener('pointermove', function (e) { activate(index, e); });
      item.hit.addEventListener('pointerleave', function () { activate(-1); });
      if (item.select) {
        item.hit.classList.add('viz-selectable');
        item.hit.addEventListener('click', function () { item.select(); });
      }
    });

    svg.setAttribute('tabindex', '0');
    svg.addEventListener('focus', function () { if (active < 0 && items.length) activate(0); });
    svg.addEventListener('blur', function () { activate(-1); });
    svg.addEventListener('keydown', function (e) {
      var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        activate(Math.min(items.length - 1, Math.max(0, active + step)));
      } else if ((e.key === 'Enter' || e.key === ' ') && active >= 0 && items[active].select) {
        e.preventDefault();
        items[active].select();
      } else if (e.key === 'Escape') {
        activate(-1);
      }
    });

    return {
      focus: function (index) {
        svg.focus({ preventScroll: true });
        activate(index);
      }
    };
  }

  function makeSvg(container, width, height, label) {
    container.textContent = '';
    var svg = svgEl('svg', {
      'class': 'viz', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
      role: 'img', 'aria-label': label, 'aria-roledescription': 'interactive chart'
    }, container);
    return svg;
  }

  /* ── vertical columns: single, grouped, or contiguous (histogram) ── */
  function columns(container, o) {
    var series = o.series;
    var n = o.categories.length;
    var W = Math.max(260, Math.floor(container.clientWidth));
    var H = o.height || 260;
    var max = 0;
    series.forEach(function (s, si) {
      o.values[si].forEach(function (v) { if (v != null && v > max) max = v; });
    });
    var ticks = niceTicks(max, H < 220 ? 3 : 4);
    var top = ticks[ticks.length - 1];
    var yFmt = o.yFormat || compact;
    var padL = Math.ceil(Math.max.apply(null, ticks.map(function (t) {
      return textWidth(yFmt(t), 'viz-tick');
    }))) + 10;
    var padT = o.refs || o.labels ? 26 : 10;
    var padB = 26;
    var plotW = W - padL - 6;
    var plotH = H - padT - padB;
    var band = plotW / n;
    var y = function (v) { return padT + plotH - (v / top) * plotH; };
    var svg = makeSvg(container, W, H, o.ariaLabel);

    ticks.forEach(function (t) {
      svgEl('line', { x1: padL, x2: W - 6, y1: y(t), y2: y(t), 'class': t === 0 ? 'viz-axis' : 'viz-grid' }, svg);
      svgText(svg, padL - 8, y(t) + 4, yFmt(t), 'viz-tick', 'end');
    });

    var ns = series.length;
    var barW;
    var groupW;
    if (o.contiguous) {
      barW = Math.max(1, band - 2);
      groupW = barW;
    } else {
      barW = Math.min(24, (band * 0.72 - 2 * (ns - 1)) / ns);
      groupW = barW * ns + 2 * (ns - 1);
    }

    var items = [];
    for (var ci = 0; ci < n; ci++) {
      var x0 = padL + ci * band + (band - groupW) / 2;
      var marks = [];
      for (var si = 0; si < ns; si++) {
        var v = o.values[si][ci];
        if (v == null || v <= 0) continue;
        var bx = x0 + si * (barW + 2);
        var bh = Math.max(1, y(0) - y(v));
        var mark = svgEl('path', {
          d: columnPath(bx, y(0) - bh, barW, bh),
          'class': 'viz-mark ' + (o.markClass ? o.markClass(si, ci) : series[si].cls)
        }, svg);
        marks.push(mark);
        var label = o.labels && o.labels(si, ci);
        if (label && textWidth(label, 'viz-value') < band + 6) {
          svgText(svg, bx + barW / 2, y(v) - 6, label, 'viz-value', 'middle');
        }
      }
      var hit = svgEl('rect', {
        x: padL + ci * band, y: padT, width: band, height: plotH, 'class': 'viz-hit'
      }, svg);
      items.push({ hit: hit, marks: marks, info: o.tip.bind(null, ci) });
    }

    // x labels: custom ticks (log axis) or thinned category labels
    if (o.xTicks) {
      o.xTicks.forEach(function (t) {
        var tx = padL + t.at * band;
        svgEl('line', { x1: tx, x2: tx, y1: y(0), y2: y(0) + 4, 'class': 'viz-axis' }, svg);
        svgText(svg, tx, H - 8, t.label, 'viz-tick', 'middle');
      });
    } else {
      var widest = Math.max.apply(null, o.categories.map(function (c) { return textWidth(c, 'viz-tick'); }));
      var every = Math.max(1, Math.ceil((widest + 8) / band));
      o.categories.forEach(function (c, i) {
        if (i % every === 0) svgText(svg, padL + (i + 0.5) * band, H - 8, c, 'viz-tick', 'middle');
      });
    }

    // reference lines: label sits beside the line, on the side given
    (o.refs || []).forEach(function (r) {
      var rx = padL + r.at * band;
      svgEl('line', { x1: rx, x2: rx, y1: padT - 6, y2: y(0), 'class': 'viz-ref' }, svg);
      svgText(svg, r.side === 'left' ? rx - 5 : rx + 5, padT - 10, r.label, 'viz-ref-label',
        r.side === 'left' ? 'end' : 'start');
    });

    // hit rects must sit above marks and labels
    items.forEach(function (item) { svg.appendChild(item.hit); });
    return bindMarks(svg, items);
  }

  /* ── horizontal bars: ranked lists, grouped pairs, selectable rows ── */
  function hbars(container, o) {
    var series = o.series;
    var n = o.categories.length;
    var ns = series.length;
    var W = Math.max(260, Math.floor(container.clientWidth));
    var thick = o.thickness || (ns > 1 ? 10 : 12);
    var rowH = o.rowHeight || (ns * thick + 2 * (ns - 1) + 10);
    var max = o.max || 0;
    series.forEach(function (s, si) {
      o.values[si].forEach(function (v) { if (v != null && v > max) max = v; });
    });
    var ticks = niceTicks(max, W < 420 ? 3 : 4);
    var top = ticks[ticks.length - 1];
    var xFmt = o.xFormat || compact;
    var labelW = Math.ceil(Math.max.apply(null, o.categories.map(function (c) {
      return textWidth(c, 'viz-cat');
    }))) + 12;
    var valueW = 0;
    if (o.labels) {
      for (var a = 0; a < ns; a++) {
        for (var b = 0; b < n; b++) {
          var lab = o.labels(a, b);
          if (lab) valueW = Math.max(valueW, textWidth(lab, 'viz-value'));
        }
      }
      valueW = Math.ceil(valueW) + 8;
    }
    var padT = o.refs ? 22 : 6;
    var padB = 26;
    var plotX = labelW;
    var plotW = W - labelW - Math.max(valueW, 14);
    var H = padT + n * rowH + padB;
    var x = function (v) { return plotX + (v / top) * plotW; };
    var svg = makeSvg(container, W, H, o.ariaLabel);

    ticks.forEach(function (t) {
      svgEl('line', { x1: x(t), x2: x(t), y1: padT, y2: padT + n * rowH, 'class': t === 0 ? 'viz-axis' : 'viz-grid' }, svg);
      svgText(svg, x(t), H - 8, xFmt(t), 'viz-tick', 'middle');
    });

    var items = [];
    for (var ci = 0; ci < n; ci++) {
      var rowY = padT + ci * rowH;
      var groupH = ns * thick + 2 * (ns - 1);
      var y0 = rowY + (rowH - groupH) / 2;
      var catCls = 'viz-cat' + (o.emphasis === ci ? ' is-emphasis' : '');
      svgText(svg, plotX - 10, rowY + rowH / 2 + 4, o.categories[ci], catCls, 'end');
      var marks = [];
      for (var si = 0; si < ns; si++) {
        var v = o.values[si][ci];
        if (v == null) continue;
        var by = y0 + si * (thick + 2);
        var bw = Math.max(1, x(v) - plotX);
        var cls = o.markClass ? o.markClass(si, ci) : series[si].cls;
        marks.push(svgEl('path', { d: rowPath(plotX, by, bw, thick), 'class': 'viz-mark ' + cls }, svg));
        var label = o.labels && o.labels(si, ci);
        if (label) svgText(svg, plotX + bw + 6, by + thick / 2 + 4, label, 'viz-value', 'start');
      }
      var hit = svgEl('rect', { x: 0, y: rowY, width: W, height: rowH, 'class': 'viz-hit' }, svg);
      items.push({
        hit: hit, marks: marks, info: o.tip.bind(null, ci),
        select: o.onSelect ? o.onSelect.bind(null, ci) : null
      });
    }

    (o.refs || []).forEach(function (r) {
      var rx = x(r.value);
      svgEl('line', { x1: rx, x2: rx, y1: padT - 4, y2: padT + n * rowH, 'class': 'viz-ref' }, svg);
      var anchor = rx + textWidth(r.label, 'viz-ref-label') + 5 > W ? 'end' : 'start';
      svgText(svg, anchor === 'end' ? rx - 5 : rx + 5, padT - 8, r.label, 'viz-ref-label', anchor);
    });

    items.forEach(function (item) { svg.appendChild(item.hit); });
    return bindMarks(svg, items);
  }

  /* ── table view: the accessible twin of every chart ── */
  function table(container, columns, rows) {
    container.textContent = '';
    var tbl = document.createElement('table');
    tbl.className = 'viz-table';
    var head = tbl.createTHead().insertRow();
    columns.forEach(function (c, i) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      if (i > 0) th.className = 'num';
      head.appendChild(th);
    });
    var body = tbl.createTBody();
    rows.forEach(function (r) {
      var tr = body.insertRow();
      r.forEach(function (cell, i) {
        var td = tr.insertCell();
        td.textContent = cell == null ? '—' : cell;
        if (i > 0) td.className = 'num';
      });
    });
    container.appendChild(tbl);
  }

  /* ── re-render on width change ── */
  function responsive(container, draw) {
    var last = 0;
    var frame = 0;
    var api = { handle: null, redraw: function () { last = container.clientWidth; api.handle = draw(); } };
    api.redraw();
    if (global.ResizeObserver) {
      new ResizeObserver(function () {
        if (Math.abs(container.clientWidth - last) < 2) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(api.redraw);
      }).observe(container);
    }
    return api;
  }

  global.ReCharts = {
    columns: columns,
    hbars: hbars,
    table: table,
    responsive: responsive,
    money: money,
    compact: compact
  };
})(window);
