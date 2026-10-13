/* ScoreChart - stacked per-problem score bars (d3 v7), no build step.
 *
 * Requires d3 v7 loaded first via <script>, e.g.
 *   <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
 *   <script src="score-chart.js"></script>
 *
 * Usage:
 *   var chart = ScoreChart.create('#ScoreChart', {
 *     onBarClick: function (user, rank) { ... }    // rank is 1-based
 *   });
 *   chart.setData({
 *     tasks: [{ id: 'A', name: 'Problem A', max: 100 }, ...],   // contest order
 *     users: [{ id: 'u1', name: 'Hari Jones',
 *               scores: { A: 45, B: 100, ... } }, ...]
 *   });
 *
 * Y axis is always 0 .. (sum of every task's max score). A task's `max`
 * defaults to opts.maxScore (100). In solo mode it is 0 .. that task's max.
 *
 * Focus:
 *   - hover a segment or a legend item  -> other tasks fade (preview)
 *   - click a legend item               -> solo that task (click again, or
 *                                          click empty chart space, to leave)
 *   - chart.focusTask('B') / chart.focusTask(null) do the same from code
 *
 * Row dimming (for table scroll/filter sync):
 *   chart.highlightRange(0, 17);  chart.highlight(fn);  chart.highlight(null);
 *
 * PNG export (toolbar buttons call these; also callable directly):
 *   chart.downloadPNG('board.png');  chart.copyPNG();  chart.toPNGBlob(2);
 */
(function (global) {
  'use strict';

  /* ---------- palette: pastel HSV, hues evenly spaced by 360/n ---------- */

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

  // Returns n colours; consecutive ones are 360/n degrees apart in hue.
  function makePalette(n, opts) {
    opts = opts || {};
    var s = opts.saturation != null ? opts.saturation : 0.42;
    var v = opts.value != null ? opts.value : 0.96;
    var h0 = opts.hueOffset != null ? opts.hueOffset : 0;
    var out = [];
    for (var i = 0; i < n; i++) out.push(hsvToHex(h0 + (i * 360) / n, s, v));
    return out;
  }

  /* ---------------------------- chart component ------------------------- */

  function create(container, options) {
    if (!global.d3) throw new Error('ScoreChart: d3 is not loaded');
    var d3 = global.d3;

    var opts = Object.assign({
      margin: { top: 10, right: 10, bottom: 8, left: 34 },
      padding: 0.2,
      duration: 300,
      maxScore: 100,
      yTicks: 5,
      dimOpacity: 0.25,
      fadeOpacity: 0.18,
      saturation: 0.42,
      value: 0.96,
      hueOffset: 0,
      autoPosition: true,
      height: 250,
      toolbar: true,
      compare: null,
      onBarClick: null,
      onFocusChange: null
    }, options || {});

    var root = d3.select(container);
    var node = root.node();
    if (!node) throw new Error('ScoreChart: container not found');

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
    var gGrid = svg.append('g').attr('class', 'sc-axis');
    var gBars = svg.append('g').attr('class', 'sc-bars');

    var legend = root.append('div')
      .attr('class', 'sc-legend')
      .style('position', 'absolute')
      .style('top', '4px')
      .style('right', '10px')
      .style('max-width', '65%')
      .style('display', 'flex')
      .style('flex-wrap', 'wrap')
      .style('justify-content', 'flex-end')
      .style('gap', '4px 6px')
      .style('z-index', '5');

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

    function toolbarButton(label, title, onClick) {
      return legend.append('div')
        .attr('class', 'sc-btn')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('padding', '1px 7px')
        .style('border-radius', '3px')
        .style('background', 'rgba(255,255,255,0.9)')
        .style('border', '1px solid #999')
        .style('font', '11px monospace')
        .style('color', '#000')
        .style('cursor', 'pointer')
        .style('user-select', 'none')
        .attr('title', title)
        .text(label)
        .on('click', onClick);
    }

    function flashButton(btn, text) {
      var old = btn.text();
      btn.text(text);
      setTimeout(function () { btn.text(old); }, 1200);
    }

    if (opts.toolbar) {
      toolbarButton('PNG', 'Download PNG', function () { downloadPNG(); });
      toolbarButton('Copy', 'Copy PNG to clipboard', function () {
        var btn = d3.select(this);
        copyPNG().then(function () {
          flashButton(btn, 'Copied');
        }, function () {
          flashButton(btn, 'Failed');
        });
      });
    }

    var state = {
      tasks: [],
      users: [],
      colors: null,
      dim: null,
      hover: null,
      solo: null,
      theme: 'light'
    };

    var THEMES = {
      light: { ink: '#000', grid: '#e3e3e3', axis: '#555', legendBg: 'rgba(255,255,255,0.85)', legendInk: '#000', legendEdge: '#ccc', page: '#ffffff' },
      dark: { ink: '#e8e8e8', grid: '#3a3d46', axis: '#999', legendBg: 'rgba(30,30,30,0.9)', legendInk: '#e8e8e8', legendEdge: '#555', page: '#14161c' }
    };

    function theme() { return THEMES[state.theme] || THEMES.light; }

    function setTheme(name) {
      state.theme = (name === 'dark') ? 'dark' : 'light';
      renderLegend();
      schedule(false);
    }

    function getTheme() { return state.theme; }

    /* ----- data normalisation ----- */

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
      var rows = (users || []).map(function (u, i) {
        var scores = {}, total = 0;
        tasks.forEach(function (t) {
          var s = +(u.scores && u.scores[t.id]) || 0;
          if (s < 0 || !isFinite(s)) s = 0;
          scores[t.id] = s;
          total += s;
        });
        return {
          id: String(u.id != null ? u.id : i),
          name: u.name != null ? u.name : String(u.id != null ? u.id : i),
          total: total,
          scores: scores,
          _i: i,
          raw: u
        };
      });
      rows.sort(function (a, b) {
        if (b.total !== a.total) return b.total - a.total;
        if (opts.compare) {
          var c = opts.compare(a.raw, b.raw);
          if (c) return c;
        }
        return a._i - b._i;
      });
      return rows;
    }

    /* ----- focus helpers ----- */

    function focusKey() { return state.hover || state.solo; }

    function applyFocus() {
      var fk = focusKey();
      gBars.selectAll('g.layer').attr('opacity', function (s) {
        return !fk || fk === s.key ? 1 : opts.fadeOpacity;
      });
      legend.selectAll('div.sc-item')
        .style('opacity', function (t) { return !fk || fk === t.id ? 1 : 0.4; })
        .style('outline', function (t) {
          return state.solo === t.id ? '2px solid ' + theme().ink : '1px solid ' + theme().legendEdge;
        })
        .style('font-weight', function (t) {
          return state.solo === t.id ? 'bold' : 'normal';
        });
    }

    function setHover(id) {
      if (state.hover === id) return;
      state.hover = id;
      applyFocus();
    }

    function setSolo(id) {
      id = id == null ? null : String(id);
      if (id !== null && !state.tasks.some(function (t) { return t.id === id; })) id = null;
      if (state.solo === id) return;
      state.solo = id;
      state.hover = null;
      hideTip();
      applyFocus();
      schedule(true);
      if (opts.onFocusChange) opts.onFocusChange(id);
    }

    function renderLegend() {
      var items = legend.selectAll('div.sc-item')
        .data(state.tasks, function (t) { return t.id; })
        .join(function (enter) {
          var d = enter.append('div')
            .attr('class', 'sc-item')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('gap', '4px')
            .style('padding', '1px 6px 1px 3px')
            .style('border-radius', '3px')
            .style('background', theme().legendBg)
            .style('font', '11px monospace')
            .style('color', theme().legendInk)
            .style('cursor', 'pointer')
            .style('user-select', 'none');
          d.append('span').attr('class', 'sc-sw')
            .style('display', 'inline-block')
            .style('width', '10px').style('height', '10px')
            .style('border-radius', '2px');
          d.append('span').attr('class', 'sc-lb');
          return d;
        });
      items.select('.sc-sw').style('background', function (t) { return state.colors(t.id); });
      items.select('.sc-lb').text(function (t) { return t.name; });
      items.style('background', theme().legendBg).style('color', theme().legendInk);
      items
        .on('mouseenter', function (event, t) { setHover(t.id); })
        .on('mouseleave', function () { setHover(null); })
        .on('click', function (event, t) {
          event.stopPropagation();
          setSolo(state.solo === t.id ? null : t.id);
        });
      applyFocus();
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

    function draw(animate) {
      var W = node.clientWidth;
      var H = node.clientHeight;
      if (!W || !H) return;

      var m = opts.margin;
      var iw = Math.max(0, W - m.left - m.right);
      var ih = Math.max(0, H - m.top - m.bottom);
      var dur = animate ? opts.duration : 0;

      svg.attr('viewBox', '0 0 ' + W + ' ' + H);

      var users = state.users;
      var shown = state.solo
        ? state.tasks.filter(function (t) { return t.id === state.solo; })
        : state.tasks;

      var possible = d3.sum(shown, function (t) { return t.max; });
      var dataMax = d3.max(users, function (u) {
        return d3.sum(shown, function (t) { return u.scores[t.id]; });
      }) || 0;
      var yMax = Math.max(possible, dataMax, 1);

      var x = d3.scaleBand()
        .domain(users.map(function (u) { return u.id; }))
        .range([0, iw])
        .padding(opts.padding);
      var y = d3.scaleLinear().domain([0, yMax]).range([ih, 0]);

      var tv = y.ticks(opts.yTicks).filter(function (v) { return v < yMax * 0.92; });
      tv.push(yMax);

      gGrid.attr('transform', 'translate(' + m.left + ',' + m.top + ')');
      gGrid.call(
        d3.axisLeft(y).tickValues(tv).tickSize(-iw).tickPadding(6)
      );
      gGrid.select('.domain').attr('stroke', theme().axis);
      gGrid.selectAll('.tick line').attr('stroke', theme().grid);
      gGrid.selectAll('.tick text').attr('fill', theme().ink).style('font-size', '11px');

      gBars.attr('transform', 'translate(' + m.left + ',' + m.top + ')');

      var series = d3.stack()
        .keys(shown.map(function (t) { return t.id; }))
        .value(function (u, k) { return u.scores[k] || 0; })
        .order(d3.stackOrderNone)
        .offset(d3.stackOffsetNone)(users);

      var taskName = {};
      state.tasks.forEach(function (t) { taskName[t.id] = t.name; });
      var rankOf = {};
      users.forEach(function (u, i) { rankOf[u.id] = i; });

      var layers = gBars.selectAll('g.layer')
        .data(series, function (s) { return s.key; })
        .join(
          function (enter) { return enter.append('g').attr('class', 'layer'); },
          function (update) { return update; },
          function (exit) {
            return exit.transition().duration(dur).attr('opacity', 0).remove();
          }
        )
        .attr('fill', function (s) { return state.colors(s.key); });

      layers.each(function (s) {
        var segs = s.filter(function (d) { return d[1] > d[0]; });
        d3.select(this).selectAll('rect')
          .data(segs, function (d) { return d.data.id; })
          .join(
            function (enter) {
              return enter.append('rect')
                .attr('x', function (d) { return x(d.data.id); })
                .attr('width', x.bandwidth())
                .attr('y', y(0))
                .attr('height', 0);
            },
            function (update) { return update; },
            function (exit) { return exit.remove(); }
          )
          .style('cursor', opts.onBarClick ? 'pointer' : 'default')
          .on('mouseenter', function (event, d) {
            setHover(s.key);
            showTip(event, d, s.key);
          })
          .on('mousemove', function (event, d) { showTip(event, d, s.key); })
          .on('mouseleave', function () { setHover(null); hideTip(); })
          .on('click', function (event, d) {
            if (opts.onBarClick) opts.onBarClick(d.data.raw, rankOf[d.data.id] + 1);
          })
          .transition().duration(dur)
          .attr('x', function (d) { return x(d.data.id); })
          .attr('width', x.bandwidth())
          .attr('y', function (d) { return y(d[1]); })
          .attr('height', function (d) { return Math.max(0, y(d[0]) - y(d[1])); });
      });

      function showTip(event, d, key) {
        var u = d.data;
        var p = d3.pointer(event, node);
        tip.style('display', 'block')
          .html(
            '#' + (rankOf[u.id] + 1) + ' ' + esc(u.name) + '<br>' +
            esc(taskName[key]) + ': ' + (d[1] - d[0]) + '<br>' +
            'Total: ' + u.total
          );
        var tw = tip.node().offsetWidth;
        var left = p[0] + 12;
        if (left + tw > W) left = p[0] - tw - 12;
        tip.style('left', Math.max(0, left) + 'px')
           .style('top', Math.max(0, p[1] - 40) + 'px');
      }

      applyDim();
      applyFocus();
    }

    function hideTip() { tip.style('display', 'none'); }

    function svgMarkup(scale) {
      var W = node.clientWidth, H = node.clientHeight;
      var clone = svg.node().cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', Math.max(1, Math.round(W * scale)));
      clone.setAttribute('height', Math.max(1, Math.round(H * scale)));
      appendLegend(clone, W);
      return new XMLSerializer().serializeToString(clone);
    }

    function appendLegend(clone, W) {
      var NS = 'http://www.w3.org/2000/svg';
      var tasks = state.tasks;
      if (!tasks.length) return;
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('font-family', 'monospace');
      g.setAttribute('font-size', '11');
      var charW = 6.63, sw = 10, gap = 4, padX = 6, itemGap = 8, lineH = 18;
      var maxRowW = W * 0.65;
      var rows = [], cur = [], curW = 0;
      tasks.forEach(function (t) {
        var w = sw + gap + t.name.length * charW + padX * 2 + itemGap;
        if (cur.length && curW + w > maxRowW) { rows.push(cur); cur = []; curW = 0; }
        cur.push(t); curW += w;
      });
      if (cur.length) rows.push(cur);
      var y = 6;
      rows.forEach(function (row) {
        var total = row.reduce(function (acc, t) {
          return acc + sw + gap + t.name.length * charW + padX * 2 + itemGap;
        }, -itemGap);
        var x = W - 10 - total;
        row.forEach(function (t) {
          var boxW = sw + gap + t.name.length * charW + padX * 2;
          var bg = document.createElementNS(NS, 'rect');
          bg.setAttribute('x', x); bg.setAttribute('y', y);
          bg.setAttribute('width', boxW); bg.setAttribute('height', 14);
          bg.setAttribute('rx', 3);
          bg.setAttribute('fill', theme().legendBg);
          bg.setAttribute('stroke', theme().legendEdge);
          g.appendChild(bg);
          var swr = document.createElementNS(NS, 'rect');
          swr.setAttribute('x', x + 3); swr.setAttribute('y', y + 2);
          swr.setAttribute('width', sw); swr.setAttribute('height', 10);
          swr.setAttribute('fill', state.colors(t.id));
          g.appendChild(swr);
          var tx = document.createElementNS(NS, 'text');
          tx.setAttribute('x', x + 3 + sw + gap); tx.setAttribute('y', y + 11);
          tx.setAttribute('fill', theme().legendInk);
          tx.textContent = t.name;
          g.appendChild(tx);
          x += boxW + itemGap;
        });
        y += lineH;
      });
      clone.appendChild(g);
    }

    function toPNGBlob(scale) {
      scale = scale || 2;
      return new Promise(function (resolve, reject) {
        var url;
        try {
          url = URL.createObjectURL(new Blob([svgMarkup(scale)], { type: 'image/svg+xml;charset=utf-8' }));
        } catch (e) { reject(e); return; }
        var img = new Image();
        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(node.clientWidth * scale));
            canvas.height = Math.max(1, Math.round(node.clientHeight * scale));
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = theme().page;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(function (b) {
              if (b) resolve(b);
              else reject(new Error('ScoreChart: PNG encode failed'));
            }, 'image/png');
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('ScoreChart: SVG raster failed'));
        };
        img.src = url;
      });
    }

    function downloadPNG(filename) {
      return toPNGBlob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename || 'score-chart.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
      });
    }

    function copyPNG() {
      if (!global.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
        return Promise.reject(new Error('ScoreChart: clipboard write unavailable'));
      }
      return toPNGBlob().then(function (blob) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      });
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function applyDim() {
      var rankOf = {};
      state.users.forEach(function (u, i) { rankOf[u.id] = i; });
      gBars.selectAll('rect').attr('opacity', function (d) {
        if (!state.dim) return 1;
        var u = d.data;
        return state.dim(u.raw, rankOf[u.id]) ? 1 : opts.dimOpacity;
      });
    }

    svg.on('click', function (event) {
      if (state.solo && event.target === svg.node()) setSolo(null);
    });

    /* ----- public API ----- */

    function setData(data) {
      state.tasks = normaliseTasks(data && data.tasks);
      state.users = normaliseUsers(data && data.users, state.tasks);
      state.colors = d3.scaleOrdinal()
        .domain(state.tasks.map(function (t) { return t.id; }))
        .range(makePalette(state.tasks.length, opts));
      if (state.solo && !state.tasks.some(function (t) { return t.id === state.solo; })) {
        state.solo = null;
      }
      state.hover = null;
      renderLegend();
      schedule(true);
    }

    function highlight(predicate) {
      state.dim = predicate || null;
      applyDim();
    }

    function highlightRange(from, to) {
      highlight(function (u, rank) { return rank >= from && rank <= to; });
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
      legend.remove();
      tip.remove();
    }

    state.colors = d3.scaleOrdinal().range([]);
    schedule(false);

    return {
      setData: setData,
      focusTask: setSolo,
      getFocus: function () { return state.solo; },
      setTheme: setTheme,
      getTheme: getTheme,
      highlight: highlight,
      highlightRange: highlightRange,
      resize: resize,
      destroy: destroy,
      downloadPNG: downloadPNG,
      copyPNG: copyPNG,
      toPNGBlob: toPNGBlob,
      getOrder: function () {
        return state.users.map(function (u) { return u.raw; });
      },
      getColors: function () {
        var o = {};
        state.tasks.forEach(function (t) { o[t.id] = state.colors(t.id); });
        return o;
      }
    };
  }

  global.ScoreChart = { create: create, makePalette: makePalette };
})(window);
