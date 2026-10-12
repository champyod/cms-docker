/* Additional ranking views for the public board: a team ranking, a per-task
 * leaderboard, a bar chart of the current standings, and a score-progression graph,
 * each reachable from a toolbar above the scoreboard. A view with no data is hidden
 * rather than shown empty, and an anonymous toggle hides every name. */

var Views = new function () {
    var self = this;

    self.current = "board";
    self.anonymous = false;
    self.teams = null;

    self.BUTTONS = [
        ["board", "Board"],
        ["teams", "Teams"],
        ["tasks", "Tasks"],
        ["scores", "Scores"],
        ["progress", "Progress"]
    ];

    self.init = function () {
        self.$panel = $("#ViewsPanel");
        if (self.$panel.length === 0) {
            return;
        }
        self.$panel.html(
            '<div id="Views_bar"></div>' +
            '<div id="Views_panels">' +
            '  <div id="Views_teams" class="views-view"></div>' +
            '  <div id="Views_tasks" class="views-view"></div>' +
            '  <div id="Views_scores" class="views-view"></div>' +
            '  <div id="Views_progress" class="views-view"></div>' +
            '</div>'
        );
        self.render_bar();
        if (document.body.getAttribute("data-board-anonymous") === "true") {
            $("#Views_anon_box").prop("checked", true);
            self.set_anonymous(true);
        }
        self.load_teams();
        self.load_progress();
        self.select("board");
    };

    self.render_bar = function () {
        var html = "";
        for (var i = 0; i < self.BUTTONS.length; i += 1) {
            var key = self.BUTTONS[i][0];
            var label = self.BUTTONS[i][1];
            html += '<button type="button" class="views-btn" data-view="' + key + '">' + label + '</button>';
        }
        html += '<label id="Views_anon"><input type="checkbox" id="Views_anon_box" /> Anonymous</label>';
        $("#Views_bar").html(html);

        $("#Views_bar").on("click", ".views-btn", function () {
            self.select($(this).data("view"));
        });
        $("#Views_anon_box").on("change", function () {
            self.set_anonymous($(this).is(":checked"));
        });
    };

    /* A view is shown only when it has something to show: an empty view is hidden,
       not drawn as a placeholder. */
    self.available = function (key) {
        if (key === "teams") {
            return self.teams !== null && Object.keys(self.teams).length > 0;
        }
        if (key === "tasks") {
            return Object.keys(DataStore.tasks).length > 0 && DataStore.user_count > 0;
        }
        if (key === "scores") {
            return DataStore.user_count > 0;
        }
        if (key === "progress") {
            return self.progress_series !== null && self.progress_series.length > 1;
        }
        return true;
    };

    self.select = function (key) {
        self.current = key;
        $("#Views_bar .views-btn").each(function () {
            $(this).toggleClass("active", $(this).data("view") === key);
        });
        $(".views-view", self.$panel).hide();
        var board = key === "board";
        $("#InnerFrame > table#Scoreboard").toggle(board);
        if (board) {
            return;
        }
        if (!self.available(key)) {
            // Nothing to show: fall back to the board rather than an empty panel.
            self.select("board");
            return;
        }
        var $view = $("#Views_" + key);
        $view.show();
        if (key === "teams") {
            self.draw_teams();
        } else if (key === "tasks") {
            self.draw_tasks();
        } else if (key === "scores") {
            self.draw_scores_chart();
        } else if (key === "progress") {
            self.draw_progress_chart();
        }
    };

    self.set_anonymous = function (on) {
        self.anonymous = on;
        $("body").toggleClass("views-anonymous", on);
        if (self.current === "teams") {
            self.draw_teams();
        } else if (self.current === "tasks") {
            self.draw_tasks();
        }
    };

    self.display_name = function (f_name, l_name) {
        if (self.anonymous) {
            return "\u2014";
        }
        var name = (f_name + " " + l_name).replace(/^\s+|\s+$/g, "");
        return name === "" ? "\u2014" : name;
    };

    self.users_by_score = function () {
        var list = [];
        for (var key in DataStore.users) {
            list.push(DataStore.users[key]);
        }
        list.sort(function (a, b) {
            return b["global"] - a["global"];
        });
        return list;
    };

    /* ---- teams ---- */

    self.load_teams = function () {
        $.ajax({
            url: Config.get_team_board_url(),
            dataType: "json",
            success: function (data) {
                self.teams = data;
            },
            error: function () {
                self.teams = {};
            }
        });
    };

    self.draw_teams = function () {
        if (!self.available("teams")) {
            return;
        }
        var rows = [];
        for (var key in self.teams) {
            rows.push(self.teams[key]);
        }
        rows.sort(function (a, b) {
            return a["rank"] - b["rank"];
        });
        var html = "<table class=\"views-table\"><thead><tr>" +
            "<th>Rank</th><th>Team</th><th>Members</th><th>Score</th>" +
            "</tr></thead><tbody>";
        for (var i = 0; i < rows.length; i += 1) {
            var team = rows[i];
            var name = self.anonymous ? "\u2014" : team["name"];
            html += "<tr><td>" + team["rank"] + "</td><td>" + name + "</td>" +
                "<td>" + team["members"].length + "</td><td>" +
                round_to_str(team["score"], DataStore.global_score_precision) + "</td></tr>";
        }
        html += "</tbody></table>";
        $("#Views_teams").html(html);
    };

    /* ---- per-task leaderboard ---- */

    self.draw_tasks = function () {
        if (!self.available("tasks")) {
            return;
        }
        var keys = [];
        for (var key in DataStore.tasks) {
            keys.push(key);
        }
        keys.sort(function (a, b) {
            return DataStore.tasks[a]["order"] - DataStore.tasks[b]["order"];
        });
        var chosen = self.task_key;
        if (chosen === null || DataStore.tasks[chosen] === undefined) {
            chosen = keys[0];
            self.task_key = chosen;
        }
        var options = "";
        for (var i = 0; i < keys.length; i += 1) {
            options += '<option value="' + keys[i] + '"' +
                (keys[i] === chosen ? " selected" : "") + ">" +
                DataStore.tasks[keys[i]]["name"] + "</option>";
        }

        var task = DataStore.tasks[chosen];
        var users = [];
        for (var u_id in DataStore.users) {
            users.push(DataStore.users[u_id]);
        }
        users.sort(function (a, b) {
            return (b["t_" + chosen] || 0) - (a["t_" + chosen] || 0);
        });

        var html = '<div id="Views_task_pick">Task: <select id="Views_task_select">' +
            options + "</select></div>" +
            '<table class="views-table"><thead><tr>' +
            "<th>Rank</th><th>Name</th><th>Score</th>" +
            "</tr></thead><tbody>";
        var rank = 0;
        var previous = null;
        for (var j = 0; j < users.length; j += 1) {
            var score = users[j]["t_" + chosen] || 0;
            if (previous === null || score !== previous) {
                rank = j + 1;
                previous = score;
            }
            html += "<tr><td>" + rank + "</td><td>" +
                self.display_name(users[j]["f_name"], users[j]["l_name"]) + "</td><td>" +
                round_to_str(score, task["score_precision"]) + "</td></tr>";
        }
        html += "</tbody></table>";
        $("#Views_tasks").html(html);
        $("#Views_task_select").on("change", function () {
            self.task_key = $(this).val();
            self.draw_tasks();
        });
    };

    /* ---- charts ---- */

    self.canvas = function (id, width, height) {
        var $canvas = $("#" + id + " canvas");
        if ($canvas.length === 0) {
            $("#" + id).html('<canvas width="' + width + '" height="' + height + '"></canvas>');
            $canvas = $("#" + id + " canvas");
        }
        return $canvas[0];
    };

    self.draw_scores_chart = function () {
        var canvas = self.canvas("Views_scores", 900, 360);
        var users = self.users_by_score();
        var context = canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height);
        var max = 0;
        for (var i = 0; i < users.length; i += 1) {
            max = Math.max(max, users[i]["global"]);
        }
        if (max <= 0 || users.length === 0) {
            return;
        }
        var pad = 24;
        var bar_width = Math.max(1, (canvas.width - pad * 2) / users.length - 2);
        context.fillStyle = "#3465a4";
        context.font = "11px sans-serif";
        context.fillStyle = "#000000";
        for (var j = 0; j < users.length; j += 1) {
            var value = users[j]["global"];
            var height = (canvas.height - pad * 2) * (value / max);
            var x = pad + j * (bar_width + 2);
            var y = canvas.height - pad - height;
            context.fillStyle = j === 0 ? "#edd400" : "#3465a4";
            context.fillRect(x, y, bar_width, height);
        }
        context.fillStyle = "#000000";
        context.fillText("Top score " + round_to_str(max, DataStore.global_score_precision) +
            " \u00b7 " + users.length + " ranked", pad, 16);
    };

    self.load_progress = function () {
        HistoryStore.request_update(function () {
            var users = self.users_by_score();
            self.progress_series = users.length > 0
                ? HistoryStore.get_score_history(users[0]["key"])
                : [];
        });
    };

    self.draw_progress_chart = function () {
        var series = self.progress_series;
        if (series === null || series.length < 2) {
            return;
        }
        var canvas = self.canvas("Views_progress", 900, 360);
        var context = canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height);
        var pad = 28;
        var max_x = series[series.length - 1][0];
        var min_x = series[0][0];
        var max_y = 0;
        for (var i = 0; i < series.length; i += 1) {
            max_y = Math.max(max_y, series[i][1]);
        }
        if (max_y <= 0 || max_x <= min_x) {
            return;
        }
        context.strokeStyle = "#3465a4";
        context.lineWidth = 2;
        context.beginPath();
        for (var j = 0; j < series.length; j += 1) {
            var x = pad + (canvas.width - pad * 2) * ((series[j][0] - min_x) / (max_x - min_x));
            var y = canvas.height - pad - (canvas.height - pad * 2) * (series[j][1] / max_y);
            if (j === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        }
        context.stroke();
        context.fillStyle = "#000000";
        context.font = "12px sans-serif";
        context.fillText("Leading score over time", pad, 18);
    };

    /* Re-draw the active view when a live change lands, so a chart is never stale. */
    self.refresh = function () {
        DataStore.score_events.add(function () {
            if (self.current !== "board") {
                self.select(self.current);
            }
        });
    };
};
