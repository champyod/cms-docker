/* The chart perspectives: a bar of the current standings and a line of the leading
 * score over time. Both draw on a canvas their own container owns. */

var PerspectiveCharts = new function () {
    var self = this;

    self.draw_scores = function ($el) {
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
        draw.fillStyle = "#000000";
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
        draw.fillStyle = "#000000";
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
