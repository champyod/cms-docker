/* The chart perspectives: a bar of the current standings and a line of the leading
 * score over time. Both draw on a canvas their own container owns. */

var PerspectiveCharts = new function () {
    var self = this;

    self.scores_chart = null;
    self.solve_chart = null;
    self.scores_frozen = {};

    self.scores_tasks = function () {
        var out = [];
        var contests = DataStore.contest_list;
        for (var key in contests) {
            var tasks = contests[key].tasks;
            for (var index in tasks) {
                out.push({ id: tasks[index].key, name: tasks[index].short_name || tasks[index].name, max: tasks[index].max_score });
            }
        }
        return out;
    };

    self.scores_name = function (u_id) {
        var renamed = DataStore.rename_for(u_id);
        if (renamed !== null) return renamed;
        var user = DataStore.users[u_id];
        var name = (user.f_name + " " + user.l_name).trim();
        return name || u_id;
    };

    self.scores_live_row = function (u_id, tasks) {
        var user = DataStore.users[u_id];
        var scores = {};
        for (var index in tasks) {
            var value = user["t_" + tasks[index].id];
            scores[tasks[index].id] = (value == null) ? 0 : value;
        }
        return { id: u_id, name: self.scores_name(u_id), scores: scores };
    };

    self.scores_data = function () {
        var tasks = self.scores_tasks();
        var users = [];
        for (var u_id in DataStore.users) {
            if (DataStore.is_hidden(u_id)) continue;
            if (self.scores_frozen[u_id]) users.push(self.scores_frozen[u_id]);
            else users.push(self.scores_live_row(u_id, tasks));
        }
        var guests = DataStore.guest_rows();
        for (var index in guests) {
            var row = guests[index];
            var scores = {};
            for (var position in tasks) scores[tasks[position].id] = 0;
            users.push({ id: row.target_key, name: row.value || row.target_key, scores: scores });
        }
        return { tasks: tasks, users: users };
    };

    self.scores_feed = function () {
        if (!self.scores_chart) return;
        self.scores_chart.setData(self.scores_data());
    };

    self.solve_feed = function () {
        if (!self.solve_chart) return;
        var data = self.scores_data();
        if (self.scores_chart) data.colors = self.scores_chart.getColors();
        self.solve_chart.setData(data);
    };

    self.scores_snapshot_freezes = function () {
        var tasks = self.scores_tasks();
        var next = {};
        for (var u_id in DataStore.users) {
            if (DataStore.freeze_hit_for(u_id) !== null) {
                next[u_id] = self.scores_frozen[u_id] || self.scores_live_row(u_id, tasks);
            }
        }
        self.scores_frozen = next;
    };

    self.scores_charts = function ($el) {
        if (!window.d3 || !window.ScoreChart || self.scores_tasks().length === 0) return false;
        if ($el.find(".persp-scores-chart").length === 0) {
            $el.empty().append('<div class="persp-scores-chart"></div><div class="persp-solve-chart"></div>');
        }
        if (!self.scores_chart) {
            try {
                self.scores_chart = ScoreChart.create($el.find(".persp-scores-chart")[0], {
                    autoPosition: false,
                    onFocusChange: function (taskId) {
                        if (self.solve_chart) self.solve_chart.focusTask(taskId);
                    }
                });
            } catch (e) {
                self.scores_chart = null;
            }
        }
        if (self.solve_chart === null && window.SolveRateChart) {
            try {
                self.solve_chart = SolveRateChart.create($el.find(".persp-solve-chart")[0], {
                    autoPosition: false,
                    onTaskClick: function (taskId) {
                        if (self.scores_chart) self.scores_chart.focusTask(taskId);
                    }
                });
            } catch (e) {
                self.solve_chart = null;
            }
        }
        if (self.scores_chart === null) return false;
        self.scores_snapshot_freezes();
        self.scores_feed();
        self.solve_feed();
        return true;
    };

    self.setTheme = function (name) {
        if (self.scores_chart) self.scores_chart.setTheme(name);
        if (self.solve_chart) self.solve_chart.setTheme(name);
    };

    self.draw_scores = function ($el) {
        if (self.scores_charts($el)) return;
        self.draw_scores_bars($el);
    };

    self.draw_scores_bars = function ($el) {
        var canvas = PerspectiveViews.ensure_canvas($el, 900, 360);
        var users = PerspectiveViews.users_by_score();
        var draw = canvas.getContext("2d");
        draw.clearRect(0, 0, canvas.width, canvas.height);
        var max = 0;
        for (var index = 0; index < users.length; index += 1) {
            max = Math.max(max, users[index]["global"]);
        }
        if (max <= 0 || users.length === 0) {
            return;
        }
        var pad = 24;
        var bar_width = Math.max(1, (canvas.width - pad * 2) / users.length - 2);
        for (var position = 0; position < users.length; position += 1) {
            var height = (canvas.height - pad * 2) * (users[position]["global"] / max);
            draw.fillStyle = position === 0 ? "#edd400" : "#3465a4";
            draw.fillRect(pad + position * (bar_width + 2), canvas.height - pad - height,
                bar_width, height);
        }
        draw.fillStyle = RWTheme.ink();
        draw.font = "11px sans-serif";
        draw.fillText("Top score " + round_to_str(max, DataStore.global_score_precision) +
            " \u00b7 " + users.length + " ranked", pad, 16);
    };

    self.draw_progress = function ($el, series) {
        if (series === null || series.length < 2) {
            return;
        }
        var canvas = PerspectiveViews.ensure_canvas($el, 900, 360);
        var draw = canvas.getContext("2d");
        draw.clearRect(0, 0, canvas.width, canvas.height);
        var pad = 28;
        var max_x = series[series.length - 1][0];
        var min_x = series[0][0];
        var max_y = 0;
        for (var index = 0; index < series.length; index += 1) {
            max_y = Math.max(max_y, series[index][1]);
        }
        if (max_y <= 0 || max_x <= min_x) {
            return;
        }
        draw.strokeStyle = "#3465a4";
        draw.lineWidth = 2;
        draw.beginPath();
        for (var position = 0; position < series.length; position += 1) {
            var x = pad + (canvas.width - pad * 2) * ((series[position][0] - min_x) / (max_x - min_x));
            var y = canvas.height - pad - (canvas.height - pad * 2) * (series[position][1] / max_y);
            if (position === 0) {
                draw.moveTo(x, y);
            } else {
                draw.lineTo(x, y);
            }
        }
        draw.stroke();
        draw.fillStyle = RWTheme.ink();
        draw.font = "12px sans-serif";
        draw.fillText("Leading score over time", pad, 18);
    };
};

Perspectives.register("scores", function () {
    var $el = null;
    return {
        label: "Scores",
        mount: function ($container) {
            $el = $container;
        },
        refresh: function () {
            if ($el !== null) {
                PerspectiveCharts.draw_scores($el);
            }
        }
    };
});

Perspectives.register("progress", function () {
    var $el = null;
    var series = null;
    return {
        label: "Progress",
        mount: function ($container) {
            $el = $container;
            HistoryStore.request_update(function () {
                var users = PerspectiveViews.users_by_score();
                series = users.length > 0 ? HistoryStore.get_score_history(users[0]["key"]) : [];
                PerspectiveCharts.draw_progress($el, series);
            });
        },
        refresh: function () {
            if ($el !== null && series !== null) {
                PerspectiveCharts.draw_progress($el, series);
            }
        }
    };
});
