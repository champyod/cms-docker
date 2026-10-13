/* SolveRateChart - per-task solve rate (d3 v7), no build step.
 *
 * One horizontal 100% bar per problem, split into:
 *   full    score >= task max      (solid task colour)
 *   partial 0 < score < task max   (task colour, translucent)
 *   none    score == 0             (grey)
 *
 * Requires d3 v7 loaded first via <script>, then this file.
 *
 * Usage:
 *   var solve = SolveRateChart.create('#SolveRate', {
 *     onTaskClick: function (taskId /* or null when cleared *\/) { ... }
 *   });
 *   solve.setData({
 *     tasks: [{ id: 'A', name: 'Problem A', max: 100 }, ...],   // contest order
 *     users: [{ id: 'u1', name: 'Hari Jones', scores: { A: 45, B: 100 } }, ...]
 *   });
 *
 * Colours are generated the same way as ScoreChart (pastel HSV, hue steps of
 * 360/n), so the two charts match as long as the palette options match.
 * Pass `colors: { A: '#...', ... }` to setData to override.
 *
 * Other methods:
 *   solve.setFilter(fn | null)   count only users where fn(rawUser) is true
 *   solve.focusTask(id | null)   fade the other rows (does NOT fire onTaskClick)
 *   solve.resize(), solve.destroy(), solve.getStats()
 */
(function (global) {
  'use strict';

  /* ---------- palette (same scheme as ScoreChart) ---------- */

  function hsvToHex(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1)      { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else             { r = c; b = x; }
    var m = v - c;
    function to255(t) {
      var n = Math.round((t + m) * 255);
      return (n < 16 ? '0' : '') + n.toString(16);
    }
    return '#' + to255(r) + to255(g) + to255(b);
  }

  function makePalette(n, o) {
    o = o || {};
    var s = o.saturation != null ? o.saturation : 0.42;
    var v = o.value != null ? o.value : 0.96;
    var h0 = o.hueOffset != null ? o.hueOffset : 0;
    var out = [];
    for (var i = 0; i < n; i++) out.push(hsvToHex(h0 + (i * 360) / n, s, v));
    return out;
  }

  /* ------------------------------ component ----------------------------- */

  function create(container, options) {
    if (!global.d3) throw new Error('SolveRateChart: d3 is not loaded');
    var d3 = global.d3;

    var opts = Object.assign({
      margin: { top: 22, right: 96, bottom: 6, left: 84 },
      rowPadding: 0.3,
      duration: 300,
      maxScore: 100,            // default per-task max if a task has no `max`
      partialOpacity: 0.45,
      zeroColor: '#e6e6e6',
      fadeOpacity: 0.25,
      saturation: 0.42,
      value: 0.96,
      hueOffset: 0,
      autoPosition: false,      // true: pin to bottom: 0, height: opts.height
      height: 250,
      onTaskClick: null         // (taskId | null) => void, fired on user click
    }, options || {});

    var root = d3.select(container);
    var node = root.node();
    if (!node) throw new Error('SolveRateChart: container not found');

    if (opts.autoPosition) {
      root.style('position', 'absolute')
          .style('left', '0').style('right', '0').style('bottom', '0')
          .style('height', opts.height + 'px');
    } else if (getComputedStyle(node).position === 'static') {
      root.style('position', 'relative');
    }
    root.style('overflow', 'hidden');

    var svg = root.append('svg')
      .style('display', 'block')
      .attr('width', '100%')
      .attr('height', '100%');
    var gLegend = svg.append('g').attr('class', 'sr-legend');
    var gRows = svg.append('g').attr('class', 'sr-rows');

    var tip = root.append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('display', 'none')
      .style('background', 'rgba(30,30,30,0.92)')
      .style('color', '#fff')
      .style('font', '12px/1.4 monospace')
      .style('padding', '5px 8px')
      .style('border-radius', '4px')
      .style('white-space', 'nowrap')
      .style('z-index', '10');

    var state = {
      tasks: [],      // [{id, name, max}]
      users: [],      // [{id, name, scores, raw}]
      colors: {},     // taskId -> colour
      filter: null,   // fn(rawUser) -> bool, or null
      hover: null,
      focus: null,
      theme: 'light'
    };

    var THEMES = {
      light: { ink: '#000', soft: '#222', zero: '#e6e6e6' },
      dark: { ink: '#e8e8e8', soft: '#c8c8c8', zero: '#4a4a4a' }
    };

    function theme() { return THEMES[state.theme] || THEMES.light; }

    function setTheme(name) {
      state.theme = (name === 'dark') ? 'dark' : 'light';
      schedule(false);
    }

    function getTheme() { return state.theme; }

    var SEG_LABEL = { full: 'Full', partial: 'Partial', zero: 'None' };

    /* ----- data ----- */

    function normaliseTasks(tasks) {
      return (tasks || []).map(function (t) {
        var o = (typeof t === 'object' && t !== null) ? t : { id: t };
        var max = +o.max;
        return {
          id: String(o.id),
          name: o.name != null ? String(o.name) : String(o.id),
          max: isFinite(max) && max > 0 ? max : opts.maxScore
        };
      });
    }

    function normaliseUsers(users, tasks) {
      return (users || []).map(function (u, i) {
        var scores = {};
        tasks.forEach(function (t) {
          var s = +(u.scores && u.scores[t.id]) || 0;
          scores[t.id] = s > 0 && isFinite(s) ? s : 0;
        });
        return {
          id: String(u.id != null ? u.id : i),
          name: u.name != null ? u.name : String(u.id != null ? u.id : i),
          scores: scores,
          raw: u
        };
      });
    }

    function computeStats() {
      var us = state.filter
        ? state.users.filter(function (u) { return state.filter(u.raw); })
        : state.users;
      return state.tasks.map(function (t) {
        var full = 0, partial = 0, zero = 0;
        us.forEach(function (u) {
          var s = u.scores[t.id];
          if (s >= t.max) full++;
          else if (s > 0) partial++;
          else zero++;
        });
        return { task: t, n: us.length, full: full, partial: partial, zero: zero };
      });
    }

    /* ----- focus ----- */

    function focusKey() { return state.hover || state.focus; }

    function applyFocus() {
      var fk = focusKey();
      gRows.selectAll('g.row').attr('opacity', function (d) {
        return !fk || fk === d.task.id ? 1 : opts.fadeOpacity;
      });
    }

    function setHover(id) {
      if (state.hover === id) return;
      state.hover = id;
      applyFocus();
    }

    function userToggle(id) {
      state.focus = state.focus === id ? null : id;
      state.hover = null;
      applyFocus();
      if (opts.onTaskClick) opts.onTaskClick(state.focus);
    }

    /* ----- drawing ----- */

    var pending = false;
    var pendingAnimate = true;

    function schedule(animate) {
      pendingAnimate = pendingAnimate && animate;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        var a = pendingAnimate;
        pendingAnimate = true;
        draw(a);
      });
    }

    function pct(c, n) { return n ? Math.round((100 * c) / n) : 0; }

    function draw(animate) {
      var W = node.clientWidth;
      var H = node.clientHeight;
      if (!W || !H) return;

      var m = opts.margin;
      var iw = Math.max(0, W - m.left - m.right);
      var ih = Math.max(0, H - m.top - m.bottom);
      var dur = animate ? opts.duration : 0;

      svg.attr('viewBox', '0 0 ' + W + ' ' + H);

      var stats = computeStats();
      var y = d3.scaleBand()
        .domain(state.tasks.map(function (t) { return t.id; }))
        .range([0, ih])
        .padding(opts.rowPadding);
      var bh = y.bandwidth();

      drawLegend(W);

      gRows.attr('transform', 'translate(' + m.left + ',' + m.top + ')');

      var maxChars = Math.max(4, Math.floor((m.left - 12) / 7));

      var rows = gRows.selectAll('g.row')
        .data(stats, function (d) { return d.task.id; })
        .join(function (enter) {
          var g = enter.append('g').attr('class', 'row');
          g.append('text').attr('class', 'lbl')
            .attr('text-anchor', 'end')
            .attr('dy', '0.35em')
            .style('font', '12px monospace')
            .style('fill', theme().ink)
            .style('cursor', 'pointer');
          g.append('g').attr('class', 'segs');
          g.append('g').attr('class', 'counts').style('pointer-events', 'none');
          g.append('text').attr('class', 'stat')
            .attr('dy', '0.35em')
            .style('font', '11px monospace')
            .style('fill', theme().ink)
            .style('pointer-events', 'none');
          return g;
        })
        .attr('transform', function (d) { return 'translate(0,' + y(d.task.id) + ')'; });

      rows.select('text.lbl')
        .attr('x', -8)
        .attr('y', bh / 2)
        .style('fill', theme().ink)
        .text(function (d) {
          var n = d.task.name;
          return n.length > maxChars ? n.slice(0, maxChars - 1) + '\u2026' : n;
        })
        .on('click', function (event, d) { userToggle(d.task.id); })
        .on('mouseenter', function (event, d) { setHover(d.task.id); })
        .on('mouseleave', function () { setHover(null); });

      rows.select('text.stat')
        .attr('x', iw + 8)
        .attr('y', bh / 2)
        .style('fill', theme().ink)
        .text(function (d) {
          return d.n ? pct(d.full, d.n) + '%  ' + d.full + '/' + d.n : '\u2013';
        });

      // segment geometry per row (full | partial | zero, left to right)
      function segsOf(d) {
        var out = [], acc = 0;
        ['full', 'partial', 'zero'].forEach(function (k) {
          var w = d.n ? (d[k] / d.n) * iw : 0;
          out.push({ key: k, c: d[k], x: acc, w: w, row: d });
          acc += w;
        });
        return out;
      }

      function fillOf(s) {
        return s.key === 'zero' ? theme().zero : state.colors[s.row.task.id];
      }
      function fillOpacityOf(s) {
        return s.key === 'partial' ? opts.partialOpacity : 1;
      }

      rows.select('g.segs').each(function (d) {
        d3.select(this).selectAll('rect')
          .data(segsOf(d), function (s) { return s.key; })
          .join(function (enter) {
            return enter.append('rect')
              .attr('x', 0).attr('width', 0)
              .attr('rx', 2);
          })
          .attr('height', bh)
          .attr('fill', fillOf)
          .attr('fill-opacity', fillOpacityOf)
          .style('cursor', 'pointer')
          .on('mouseenter', function (event, s) { setHover(s.row.task.id); showTip(event, s); })
          .on('mousemove', function (event, s) { showTip(event, s); })
          .on('mouseleave', function () { setHover(null); hideTip(); })
          .on('click', function (event, s) { userToggle(s.row.task.id); })
          .transition().duration(dur)
          .attr('x', function (s) { return s.x; })
          .attr('width', function (s) { return s.w; });
      });

      // counts inside segments, only when they fit
      rows.select('g.counts').each(function (d) {
        d3.select(this).selectAll('text')
          .data(segsOf(d), function (s) { return s.key; })
          .join(function (enter) {
            return enter.append('text')
              .attr('text-anchor', 'middle')
              .attr('dy', '0.35em')
              .style('font', '11px monospace')
              .style('fill', theme().soft);
          })
          .attr('y', bh / 2)
          .style('fill', theme().soft)
          .text(function (s) { return s.w >= 24 && bh >= 12 && s.c ? s.c : ''; })
          .transition().duration(dur)
          .attr('x', function (s) { return s.x + s.w / 2; });
      });

      applyFocus();

      function showTip(event, s) {
        var d = s.row;
        var p = d3.pointer(event, node);
        tip.style('display', 'block')
          .html(
            esc(d.task.name) + '<br>' +
            SEG_LABEL[s.key] + ': ' + s.c + ' (' + pct(s.c, d.n) + '%)<br>' +
            'of ' + d.n + ' participants'
          );
        var tw = tip.node().offsetWidth;
        var left = p[0] + 12;
        if (left + tw > W) left = p[0] - tw - 12;
        tip.style('left', Math.max(0, left) + 'px')
           .style('top', Math.max(0, p[1] - 44) + 'px');
      }
    }

    function drawLegend(W) {
      var items = [
        { key: 'full', label: 'Full', fo: 1, fill: '#8a8a8a' },
        { key: 'partial', label: 'Partial', fo: opts.partialOpacity, fill: '#8a8a8a' },
        { key: 'zero', label: 'None', fo: 1, fill: theme().zero }
      ];
      var itemW = 64;
      var x0 = W - opts.margin.right - itemW * items.length;
      gLegend.attr('transform', 'translate(' + Math.max(0, x0) + ',4)');
      var g = gLegend.selectAll('g.item')
        .data(items, function (d) { return d.key; })
        .join(function (enter) {
          var e = enter.append('g').attr('class', 'item');
          e.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2);
          e.append('text').attr('x', 14).attr('y', 9)
            .style('font', '11px monospace').style('fill', theme().ink);
          return e;
        })
        .attr('transform', function (d, i) { return 'translate(' + i * itemW + ',0)'; });
      g.select('rect')
        .attr('fill', function (d) { return d.fill; })
        .attr('fill-opacity', function (d) { return d.fo; });
      g.select('text').text(function (d) { return d.label; });
    }

    function hideTip() { tip.style('display', 'none'); }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    /* ----- public API ----- */

    function setData(data) {
      state.tasks = normaliseTasks(data && data.tasks);
      state.users = normaliseUsers(data && data.users, state.tasks);
      var palette = makePalette(state.tasks.length, opts);
      state.colors = {};
      state.tasks.forEach(function (t, i) {
        state.colors[t.id] = (data && data.colors && data.colors[t.id]) || palette[i];
      });
      if (state.focus && !state.tasks.some(function (t) { return t.id === state.focus; })) {
        state.focus = null;
      }
      state.hover = null;
      schedule(true);
    }

    // count only users for whom fn(rawUser) is true; null counts everyone
    function setFilter(fn) {
      state.filter = fn || null;
      schedule(true);
    }

    // programmatic focus, e.g. mirroring ScoreChart's solo; no callback fired
    function focusTask(id) {
      state.focus = id == null ? null : String(id);
      state.hover = null;
      applyFocus();
    }

    function resize() { schedule(false); }

    var resizeTimer = null;
    function onWinResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 100);
    }
    var ro = null;
    if (global.ResizeObserver) {
      ro = new ResizeObserver(onWinResize);
      ro.observe(node);
    } else {
      global.addEventListener('resize', onWinResize);
    }

    function destroy() {
      clearTimeout(resizeTimer);
      if (ro) ro.disconnect(); else global.removeEventListener('resize', onWinResize);
      svg.remove();
      tip.remove();
    }

    schedule(false);

    return {
      setData: setData,
      setFilter: setFilter,
      focusTask: focusTask,
      setTheme: setTheme,
      getTheme: getTheme,
      resize: resize,
      destroy: destroy,
      getStats: computeStats
    };
  }

  global.SolveRateChart = { create: create, makePalette: makePalette };
})(window);
