/* SolveRateChart drawing methods, installed on the prototype built by
 * solve-rate-chart.js. Load order: logic, core, this. */
(function (global) {
  'use strict';

  var Chart = global.SolveRateChart;
  if (!Chart) throw new Error('SolveRateChart: solve-rate-chart.js is not loaded');
  var Logic = global.SolveRateChartLogic;

  var LEGEND_ITEMS = [
    { key: 'full', label: 'Full', fo: 1, fill: '#8a8a8a' },
    { key: 'partial', label: 'Partial', fo: null, fill: '#8a8a8a' },
    { key: 'zero', label: 'None', fo: 1, fill: null }
  ];

  Chart.prototype.rowGeometry = function () {
    var width = this.node.clientWidth;
    var height = this.node.clientHeight;
    if (!width || !height) return null;
    var margin = this.opts.margin;
    var innerWidth = Math.max(0, width - margin.left - margin.right);
    var innerHeight = Math.max(0, height - margin.top - margin.bottom);
    var y = this.d3.scaleBand()
      .domain(this.state.tasks.map(function (t) { return t.id; }))
      .range([0, innerHeight])
      .padding(this.opts.rowPadding);
    return { width: width, height: height, margin: margin, innerWidth: innerWidth, y: y, band: y.bandwidth() };
  };

  Chart.prototype.joinRows = function (stats, geometry, maxChars) {
    var self = this;
    var rows = this.rows.selectAll('g.row')
      .data(stats, function (d) { return d.task.id; })
      .join(function (enter) {
        var row = enter.append('g').attr('class', 'row');
        row.append('text').attr('class', 'lbl')
          .attr('text-anchor', 'end').attr('dy', '0.35em')
          .style('font', '12px monospace').style('fill', '#000').style('cursor', 'pointer');
        row.append('g').attr('class', 'segs');
        row.append('g').attr('class', 'counts').style('pointer-events', 'none');
        row.append('text').attr('class', 'stat')
          .attr('dy', '0.35em').style('font', '11px monospace')
          .style('fill', '#000').style('pointer-events', 'none');
        return row;
      })
      .attr('transform', function (d) { return 'translate(0,' + geometry.y(d.task.id) + ')'; });

    rows.select('text.lbl')
      .attr('x', -8).attr('y', geometry.band / 2)
      .text(function (d) {
        var name = d.task.name;
        return name.length > maxChars ? name.slice(0, maxChars - 1) + '\u2026' : name;
      })
      .on('click', function (event, d) { self.userToggle(d.task.id); })
      .on('mouseenter', function (event, d) { self.setHover(d.task.id); })
      .on('mouseleave', function () { self.setHover(null); });

    rows.select('text.stat')
      .attr('x', geometry.innerWidth + 8).attr('y', geometry.band / 2)
      .text(function (d) {
        return d.n ? Logic.pct(d.full, d.n) + '%  ' + d.full + '/' + d.n : '\u2013';
      });
    return rows;
  };

  Chart.prototype.drawSegments = function (rows, geometry, duration) {
    var self = this;
    var d3 = this.d3;
    var opts = this.opts;
    var colors = this.state.colors;
    rows.select('g.segs').each(function (d) {
      d3.select(this).selectAll('rect')
        .data(Logic.segsOf(d, geometry.innerWidth), function (s) { return s.key; })
        .join(function (enter) {
          return enter.append('rect').attr('x', 0).attr('width', 0).attr('rx', 2);
        })
        .attr('height', geometry.band)
        .attr('fill', function (s) { return s.key === 'zero' ? opts.zeroColor : colors[s.row.task.id]; })
        .attr('fill-opacity', function (s) { return s.key === 'partial' ? opts.partialOpacity : 1; })
        .style('cursor', 'pointer')
        .on('mouseenter', function (event, s) { self.setHover(s.row.task.id); self.showTip(event, s, geometry.width); })
        .on('mousemove', function (event, s) { self.showTip(event, s, geometry.width); })
        .on('mouseleave', function () { self.setHover(null); self.hideTip(); })
        .on('click', function (event, s) { self.userToggle(s.row.task.id); })
        .transition().duration(duration)
        .attr('x', function (s) { return s.x; })
        .attr('width', function (s) { return s.w; });
    });
  };

  Chart.prototype.drawCounts = function (rows, geometry, duration) {
    var d3 = this.d3;
    rows.select('g.counts').each(function (d) {
      d3.select(this).selectAll('text')
        .data(Logic.segsOf(d, geometry.innerWidth), function (s) { return s.key; })
        .join(function (enter) {
          return enter.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
            .style('font', '11px monospace').style('fill', '#222');
        })
        .attr('y', geometry.band / 2)
        .text(function (s) { return s.w >= 24 && geometry.band >= 12 && s.c ? s.c : ''; })
        .transition().duration(duration)
        .attr('x', function (s) { return s.x + s.w / 2; });
    });
  };

  Chart.prototype.drawLegend = function (width) {
    var opts = this.opts;
    var items = LEGEND_ITEMS.map(function (item) {
      return Object.assign({}, item, {
        fo: item.fo === null ? opts.partialOpacity : item.fo,
        fill: item.fill === null ? opts.zeroColor : item.fill
      });
    });
    var itemWidth = 64;
    var startX = width - opts.margin.right - itemWidth * items.length;
    this.legend.attr('transform', 'translate(' + Math.max(0, startX) + ',4)');
    var group = this.legend.selectAll('g.item')
      .data(items, function (d) { return d.key; })
      .join(function (enter) {
        var item = enter.append('g').attr('class', 'item');
        item.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2);
        item.append('text').attr('x', 14).attr('y', 9).style('font', '11px monospace').style('fill', '#000');
        return item;
      })
      .attr('transform', function (d, index) { return 'translate(' + index * itemWidth + ',0)'; });
    group.select('rect').attr('fill', function (d) { return d.fill; })
      .attr('fill-opacity', function (d) { return d.fo; });
    group.select('text').text(function (d) { return d.label; });
  };

  Chart.prototype.hideTip = function () {
    this.tip.style('display', 'none');
  };

  Chart.prototype.showTip = function (event, segment, width) {
    var row = segment.row;
    var point = this.d3.pointer(event, this.node);
    this.tip.style('display', 'block').html(
      Logic.esc(row.task.name) + '<br>' +
      Logic.SEG_LABEL[segment.key] + ': ' + segment.c + ' (' + Logic.pct(segment.c, row.n) + '%)<br>' +
      'of ' + row.n + ' participants'
    );
    var tipWidth = this.tip.node().offsetWidth;
    var left = point[0] + 12;
    if (left + tipWidth > width) left = point[0] - tipWidth - 12;
    this.tip.style('left', Math.max(0, left) + 'px').style('top', Math.max(0, point[1] - 44) + 'px');
  };

  Chart.prototype.draw = function (animate) {
    var geometry = this.rowGeometry();
    if (!geometry) return;
    var duration = animate ? this.opts.duration : 0;
    this.svg.attr('viewBox', '0 0 ' + geometry.width + ' ' + geometry.height);
    var stats = Logic.computeStats(this.state.tasks, this.state.users, this.state.filter);
    this.drawLegend(geometry.width);
    this.rows.attr('transform', 'translate(' + geometry.margin.left + ',' + geometry.margin.top + ')');
    var maxChars = Math.max(4, Math.floor((geometry.margin.left - 12) / 7));
    var rows = this.joinRows(stats, geometry, maxChars);
    this.drawSegments(rows, geometry, duration);
    this.drawCounts(rows, geometry, duration);
    this.applyFocus();
  };
})(window);
