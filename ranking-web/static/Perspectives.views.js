/* The board, teams and per-task perspectives, and the helpers the chart views share. */

var PerspectiveViews = new function () {
    var self = this;

    self.table = function (headers, rows) {
        var html = '<table class="views-table"><thead><tr>';
        for (var column = 0; column < headers.length; column += 1) {
            html += "<th>" + escapeHTML(headers[column]) + "</th>";
        }
        html += "</tr></thead><tbody>";
        for (var row = 0; row < rows.length; row += 1) {
            html += "<tr>";
            for (var cell = 0; cell < rows[row].length; cell += 1) {
                html += "<td>" + rows[row][cell] + "</td>";
            }
            html += "</tr>";
        }
        return html + "</tbody></table>";
    };

    self.ensure_canvas = function ($container, width, height) {
        if ($container.find("canvas").length === 0) {
            $container.html('<canvas width="' + width + '" height="' + height + '"></canvas>');
        }
        return $container.find("canvas")[0];
    };

    self.users_by_score = function () {
        var list = [];
        for (var key in DataStore.users) {
            list.push(DataStore.users[key]);
        }
        list.sort(function (left, right) {
            return right["global"] - left["global"];
        });
        return list;
    };

    self.draw_teams = function (context, $el, teams) {
        var rows = [];
        for (var key in teams) {
            rows.push(teams[key]);
        }
        rows.sort(function (left, right) {
            return left["rank"] - right["rank"];
        });
        var body = [];
        for (var index = 0; index < rows.length; index += 1) {
            var team = rows[index];
            var name = context.anonymous ? "\u2014" : escapeHTML(team["name"]);
            body.push([
                team["rank"],
                name,
                team["members"].length,
                round_to_str(team["score"], DataStore.global_score_precision)
            ]);
        }
        $el.html(self.table(["Rank", "Team", "Members", "Score"], body));
    };

    function task_options(keys, chosen) {
        var options = "";
        for (var index = 0; index < keys.length; index += 1) {
            options += '<option value="' + keys[index] + '"' +
                (keys[index] === chosen ? " selected" : "") + ">" +
                escapeHTML(DataStore.tasks[keys[index]]["name"]) + "</option>";
        }
        return options;
    }

    function task_rows(context, users, chosen) {
        var body = [];
        for (var index = 0; index < users.length; index += 1) {
            var score = users[index]["t_" + chosen] || 0;
            body.push([
                index + 1,
                escapeHTML(context.display_name(users[index]["f_name"], users[index]["l_name"])),
                round_to_str(score, DataStore.tasks[chosen]["score_precision"])
            ]);
        }
        return body;
    }

    self.draw_tasks = function (context, $el, setChosen, getChosen) {
        var keys = [];
        for (var key in DataStore.tasks) {
            if (!DataStore.active_contests[DataStore.tasks[key]["contest"]]) continue;
            keys.push(key);
        }
        keys.sort(function (left, right) {
            return DataStore.tasks[left]["order"] - DataStore.tasks[right]["order"];
        });
        if (keys.length === 0) {
            $el.html("");
            return;
        }
        var chosen = getChosen();
        if (chosen === null || DataStore.tasks[chosen] === undefined ||
                !DataStore.active_contests[DataStore.tasks[chosen]["contest"]]) {
            chosen = keys[0];
            setChosen(chosen);
        }
        var users = self.users_by_score();
        users.sort(function (left, right) {
            return (right["t_" + chosen] || 0) - (left["t_" + chosen] || 0);
        });
        $el.html('<div id="Views_task_pick">Task: <select id="Views_task_select">' +
            task_options(keys, chosen) + "</select></div>" +
            self.table(["Rank", "Name", "Score"], task_rows(context, users, chosen)));
        $el.find("#Views_task_select").on("change", function () {
            setChosen($(this).val());
            self.draw_tasks(context, $el, setChosen, getChosen);
        });
    };
};

Perspectives.register("board", function () {
    return {
        label: "Board",
        mount: function () {},
        refresh: function () {}
    };
});

Perspectives.register("teams", function () {
    var data = null;
    var $el = null;
    return {
        label: "Teams",
        mount: function ($container) {
            $el = $container;
            $.ajax({
                url: Config.get_team_board_url(),
                dataType: "json",
                success: function (payload) {
                    data = payload;
                    PerspectiveViews.draw_teams(Perspectives, $el, data);
                },
                error: function () {
                    data = {};
                }
            });
        },
        refresh: function () {
            if ($el !== null && data !== null) {
                PerspectiveViews.draw_teams(Perspectives, $el, data);
            }
        }
    };
});

Perspectives.register("tasks", function () {
    var $el = null;
    var chosen = null;
    function set(next) {
        chosen = next;
    }
    function get() {
        return chosen;
    }
    return {
        label: "Tasks",
        mount: function ($container) {
            $el = $container;
            chosen = null;
            PerspectiveViews.draw_tasks(Perspectives, $el, set, get);
        },
        refresh: function () {
            if ($el !== null) {
                PerspectiveViews.draw_tasks(Perspectives, $el, set, get);
            }
        }
    };
});
