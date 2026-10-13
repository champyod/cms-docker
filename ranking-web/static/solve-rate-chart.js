/* SolveRateChart core: construction, state, focus and the public API. The pure
 * helpers live in solve-rate-chart.logic.js and the drawing methods in
 * solve-rate-chart.draw.js; load both before this file. */
(function (global) {
  'use strict';

  var Logic = global.SolveRateChartLogic;
  if (!Logic) throw new Error('SolveRateChart: solve-rate-chart.logic.js is not loaded');

  var DEFAULT_OPTIONS = {
    margin: { top: 22, right: 96, bottom: 6, left: 84 },
    rowPadding: 0.3,
    duration: 300,
    maxScore: 100,
    partialOpacity: 0.45,
    zeroColor: '#e6e6e6',
    fadeOpacity: 0.25,
    saturation: 0.42,
    value: 0.96,
    hueOffset: 0,
    autoPosition: false,
    height: 250,
    onTaskClick: null
  };

  function applyPosition(root, node, options) {
    if (options.autoPosition) {
      root.style('position', 'absolute')
        .style('left', '0').style('right', '0').style('bottom', '0')
        .style('height', options.height + 'px');
    } else if (getComputedStyle(node).position === 'static') {
      root.style('position', 'relative');
    }
    root.style('overflow', 'hidden');
  }

  function buildLayers(root) {
    var svg = root.append('svg')
      .style('display', 'block').attr('width', '100%').attr('height', '100%');
    return {
      svg: svg,
      legend: svg.append('g').attr('class', 'sr-legend'),
      rows: svg.append('g').attr('class', 'sr-rows')
    };
  }

  function buildTip(root) {
    return root.append('div')
      .style('position', 'absolute').style('pointer-events', 'none')
      .style('display', 'none').style('background', 'rgba(30,30,30,0.92)')
      .style('color', '#fff').style('font', '12px/1.4 monospace')
      .style('padding', '5px 8px').style('border-radius', '4px')
      .style('white-space', 'nowrap').style('z-index', '10');
  }

  function SolveRateChart(d3, container, options) {
    if (!d3) throw new Error('SolveRateChart: d3 is not loaded');
    this.d3 = d3;
    this.opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    this.root = d3.select(container);
    this.node = this.root.node();
    if (!this.node) throw new Error('SolveRateChart: container not found');

    applyPosition(this.root, this.node, this.opts);
    var layers = buildLayers(this.root);
    this.svg = layers.svg;
    this.legend = layers.legend;
    this.rows = layers.rows;
    this.tip = buildTip(this.root);

    this.state = { tasks: [], users: [], colors: {}, filter: null, hover: null, focus: null };
    this.pending = false;
    this.pendingAnimate = true;
    this.resizeTimer = null;
    this.resizeObserver = null;
    this.resizeHandler = this.onWinResize.bind(this);

    this.attachResize();
    this.schedule(false);
  }

  SolveRateChart.prototype.focusKey = function () {
    return this.state.hover || this.state.focus;
  };

  SolveRateChart.prototype.applyFocus = function () {
    var key = this.focusKey();
    var fadeOpacity = this.opts.fadeOpacity;
    this.rows.selectAll('g.row').attr('opacity', function (d) {
      return !key || key === d.task.id ? 1 : fadeOpacity;
    });
  };

  SolveRateChart.prototype.setHover = function (id) {
    if (this.state.hover === id) return;
    this.state.hover = id;
    this.applyFocus();
  };

  SolveRateChart.prototype.userToggle = function (id) {
    this.state.focus = this.state.focus === id ? null : id;
    this.state.hover = null;
    this.applyFocus();
    if (this.opts.onTaskClick) this.opts.onTaskClick(this.state.focus);
  };

  SolveRateChart.prototype.schedule = function (animate) {
    var self = this;
    this.pendingAnimate = this.pendingAnimate && animate;
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(function () {
      self.pending = false;
      var runAnimate = self.pendingAnimate;
      self.pendingAnimate = true;
      self.draw(runAnimate);
    });
  };

  SolveRateChart.prototype.setData = function (data) {
    this.state.tasks = Logic.normaliseTasks(data && data.tasks, this.opts.maxScore);
    this.state.users = Logic.normaliseUsers(data && data.users, this.state.tasks);
    var palette = Logic.makePalette(this.state.tasks.length, this.opts);
    var colors = {};
    var dataColors = (data && data.colors) || {};
    this.state.tasks.forEach(function (task, index) {
      colors[task.id] = dataColors[task.id] || palette[index];
    });
    this.state.colors = colors;
    if (this.state.focus && !this.state.tasks.some(function (t) { return t.id === this.state.focus; }, this)) {
      this.state.focus = null;
    }
    this.state.hover = null;
    this.schedule(true);
  };

  SolveRateChart.prototype.setFilter = function (fn) {
    this.state.filter = fn || null;
    this.schedule(true);
  };

  SolveRateChart.prototype.focusTask = function (id) {
    this.state.focus = id == null ? null : String(id);
    this.state.hover = null;
    this.applyFocus();
  };

  SolveRateChart.prototype.resize = function () {
    this.schedule(false);
  };

  SolveRateChart.prototype.onWinResize = function () {
    var self = this;
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(function () { self.resize(); }, 100);
  };

  SolveRateChart.prototype.attachResize = function () {
    if (global.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.resizeHandler);
      this.resizeObserver.observe(this.node);
    } else {
      global.addEventListener('resize', this.resizeHandler);
    }
  };

  SolveRateChart.prototype.destroy = function () {
    clearTimeout(this.resizeTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else global.removeEventListener('resize', this.resizeHandler);
    this.svg.remove();
    this.tip.remove();
  };

  SolveRateChart.prototype.getStats = function () {
    return Logic.computeStats(this.state.tasks, this.state.users, this.state.filter);
  };

  SolveRateChart.create = function (container, options) {
    return new SolveRateChart(global.d3, container, options);
  };
  SolveRateChart.makePalette = Logic.makePalette;

  global.SolveRateChart = SolveRateChart;
})(window);
