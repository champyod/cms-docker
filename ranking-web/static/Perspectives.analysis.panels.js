/* The six analysis panels: each draws into the shared panel element and reads the
 * live stores through the analysis shell it is handed. */

var PerspectiveAnalysisPanels = new function () {
    var self = this;

    var WIDTH = 900;
    var HEIGHT = 360;
    var PAD = 28;
    var BUCKETS = 10;
    var HEAT_LIGHT = 90;
    var HEAT_DARK = 55;
    var NO_TEAM = "\u2014";
    var BUMP_COLORS = [
        "#3465a4", "#edd400", "#cc0000", "#73d216",
        "#f57900", "#75507b", "#888a85", "#c17d11"
    ];

    function all_users() {
        var users = [];
        for (var key in DataStore.users) {
            users.push(DataStore.users[key]);
        }
        return users;
    }

    function max_cell(table, rows, columns) {
        var max = 0;
        for (var row = 0; row < rows.length; row += 1) {
            for (var column = 0; column < columns.length; column += 1) {
                max = Math.max(max, table[rows[row]][columns[column]]);
            }
        }
        return max;
    }

    function heat_color(value, max) {
        if (max <= 0) {
            return "transparent";
        }
        var lightness = HEAT_LIGHT - (HEAT_LIGHT - HEAT_DARK) * (value / max);
        return "hsl(120, 30%, " + Math.round(lightness) + "%)";
    }

    function signed(value, precision) {
        if (value === 0) {
            return "0";
        }
        return (value > 0 ? "+" : "") + round_to_str(value, precision);
    }

    self.bump = function ($panel, analysis) {
        var users = analysis.users();
        var times = analysis.sample_times();
        if (users.length === 0 || times.length < 2) {
            $panel.html("");
            return;
        }
        var samples = PerspectivesAnalysisLogic.ranksOverTime(analysis.series(), times);
        var canvas = PerspectiveViews.ensure_canvas($panel, WIDTH, HEIGHT);
        var draw = canvas.getContext("2d");
        draw.clearRect(0, 0, WIDTH, HEIGHT);
        for (var index = 0; index < users.length; index += 1) {
            draw.strokeStyle = BUMP_COLORS[index % BUMP_COLORS.length];
            draw.lineWidth = 2;
            draw.beginPath();
            for (var point = 0; point < samples.length; point += 1) {
                var rank = samples[point].ranks[users[index].key] || users.length;
                var x = PAD + (WIDTH - PAD * 2) * point / (samples.length - 1);
                var y = PAD + (HEIGHT - PAD * 2) * (rank - 1) / Math.max(1, users.length - 1);
                if (point === 0) {
                    draw.moveTo(x, y);
                } else {
                    draw.lineTo(x, y);
                }
            }
            draw.stroke();
        }
        draw.fillStyle = "#000000";
        draw.font = "11px sans-serif";
        draw.fillText("Rank over time \u00b7 " + users.length + " ranked", PAD, 14);
    };

    self.heatmap = function ($panel, analysis) {
        var tasks = analysis.task_keys();
        var users = all_users();
        if (tasks.length === 0 || users.length === 0) {
            $panel.html("");
            return;
        }
        var table = PerspectivesAnalysisLogic.sumMatrix(users,
            function (user) { return user["team"] || NO_TEAM; },
            tasks,
            function (user, task) { return user["t_" + task] || 0; });
        var teams = Object.keys(table).sort();
        var max = max_cell(table, teams, tasks);
        var head = "<tr><th>Team</th>";
        for (var column = 0; column < tasks.length; column += 1) {
            head += "<th>" + analysis.task_label(tasks[column]) + "</th>";
        }
        var rows = "";
        for (var index = 0; index < teams.length; index += 1) {
            rows += "<tr><td>" + analysis.team_label(teams[index]) + "</td>";
            for (var task = 0; task < tasks.length; task += 1) {
                var value = table[teams[index]][tasks[task]];
                rows += '<td class="persp-analysis-cell" style="background-color:' +
                    heat_color(value, max) + '">' +
                    round_to_str(value, analysis.precision()) + "</td>";
            }
            rows += "</tr>";
        }
        $panel.html('<table class="views-table persp-analysis-heat"><thead>' + head +
            "</tr></thead><tbody>" + rows + "</tbody></table>");
    };

    self.head = function ($panel, analysis) {
        var users = analysis.users();
        if (users.length === 0) {
            $panel.html("");
            return;
        }
        $panel.html(head_controls(analysis, users) + '<div id="Persp_analysis_head"></div>');
        $panel.find(".persp-analysis-user").on("change", function () {
            if ($(this).data("side") === "left") {
                analysis.left = $(this).val();
            } else {
                analysis.right = $(this).val();
            }
            head_table($panel, analysis);
        });
        head_table($panel, analysis);
    };

    function head_controls(analysis, users) {
        return '<div class="persp-analysis-pick">' +
            side_select("left", analysis.left, users, analysis) + " vs " +
            side_select("right", analysis.right, users, analysis) + "</div>";
    }

    function side_select(side, chosen, users, analysis) {
        var options = "";
        for (var index = 0; index < users.length; index += 1) {
            var key = users[index].key;
            options += '<option value="' + key + '"' + (key === chosen ? " selected" : "") +
                ">" + analysis.name(key) + "</option>";
        }
        return "<label>" + side + ': <select class="persp-analysis-user" data-side="' + side +
            '">' + options + "</select></label>";
    }

    function head_table($panel, analysis) {
        var rows = PerspectivesAnalysisLogic.compareTasks(analysis.left, analysis.right,
            analysis.task_keys(), function (key, task) {
                var user = DataStore.users[key];
                return user === undefined ? 0 : (user["t_" + task] || 0);
            });
        var body = [];
        for (var index = 0; index < rows.length; index += 1) {
            body.push([
                analysis.task_label(rows[index].task),
                round_to_str(rows[index].left, analysis.precision()),
                round_to_str(rows[index].right, analysis.precision()),
                signed(rows[index].delta, analysis.precision())
            ]);
        }
        $panel.find("#Persp_analysis_head").html(PerspectiveViews.table(
            ["Task", analysis.name(analysis.left), analysis.name(analysis.right), "\u0394"], body));
    }

    self.distribution = function ($panel, analysis) {
        var users = analysis.users();
        var values = [];
        for (var index = 0; index < users.length; index += 1) {
            values.push(users[index]["global"]);
        }
        if (values.length === 0) {
            $panel.html("");
            return;
        }
        var max = DataStore.global_max_score > 0
            ? DataStore.global_max_score
            : Math.max.apply(null, values);
        var counts = PerspectivesLogic.histogram(values, BUCKETS, max);
        var canvas = PerspectiveViews.ensure_canvas($panel, WIDTH, HEIGHT);
        var draw = canvas.getContext("2d");
        draw.clearRect(0, 0, WIDTH, HEIGHT);
        var peak = Math.max.apply(null, counts.concat([1]));
        var bar = (WIDTH - PAD * 2) / counts.length;
        for (var bucket = 0; bucket < counts.length; bucket += 1) {
            var height = (HEIGHT - PAD * 2) * counts[bucket] / peak;
            draw.fillStyle = "#73d216";
            draw.fillRect(PAD + bucket * bar, HEIGHT - PAD - height, Math.max(1, bar - 2), height);
        }
        draw.fillStyle = "#000000";
        draw.font = "11px sans-serif";
        draw.fillText("Scores 0 to " + round_to_str(max, analysis.precision()) + " \u00b7 " +
            values.length + " users", PAD, 14);
    };

    self.projection = function ($panel, analysis) {
        var series = analysis.series();
        var end = PerspectiveTime.span().end;
        var users = analysis.users();
        var body = [];
        for (var index = 0; index < users.length; index += 1) {
            var current = users[index]["global"];
            var projected = PerspectivesAnalysisLogic.projectScore(
                series[users[index].key] || [], end);
            body.push([
                users[index]["rank"],
                analysis.name(users[index].key),
                round_to_str(current, analysis.precision()),
                round_to_str(projected, analysis.precision()),
                signed(projected - current, analysis.precision())
            ]);
        }
        $panel.html(PerspectiveViews.table(["Rank", "Name", "Now", "Projected", "\u0394"], body));
    };

    self.matrix = function ($panel, analysis) {
        var tasks = analysis.task_keys();
        var users = analysis.users();
        if (tasks.length === 0 || users.length === 0) {
            $panel.html("");
            return;
        }
        var table = PerspectivesAnalysisLogic.sumMatrix(users,
            function (user) { return user["key"]; },
            tasks,
            function (user, task) { return user["t_" + task] || 0; });
        var head = "<tr><th>Task</th>";
        var rows = "";
        for (var index = 0; index < users.length; index += 1) {
            head += "<th>" + analysis.name(users[index].key) + "</th>";
        }
        for (var row = 0; row < tasks.length; row += 1) {
            rows += "<tr><td>" + analysis.task_label(tasks[row]) + "</td>";
            for (var column = 0; column < users.length; column += 1) {
                rows += "<td>" + round_to_str(table[users[column].key][tasks[row]],
                    analysis.precision()) + "</td>";
            }
            rows += "</tr>";
        }
        $panel.html('<table class="views-table persp-analysis-matrix"><thead>' + head +
            "</tr></thead><tbody>" + rows + "</tbody></table>");
    };
};
