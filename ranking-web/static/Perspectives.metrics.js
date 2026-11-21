/* The metrics perspective: per-user solved counts, medal cutoffs, the first solver
 * of each task and a live ticker of score gains. */

var PerspectiveMetrics = new function () {
    var self = this;

    self.ACTIVITY_LIMIT = 20;

    self.$el = null;
    self.medals = null;
    self.activity = [];

    self.task_keys = function () {
        var keys = [];
        for (var key in DataStore.tasks) {
            keys.push(key);
        }
        keys.sort(function (left, right) {
            return DataStore.tasks[left]["order"] - DataStore.tasks[right]["order"];
        });
        return keys;
    };

    self.name = function (user_key) {
        var user = DataStore.users[user_key];
        if (user === undefined) {
            return user_key;
        }
        return escapeHTML(Perspectives.display_name(user["f_name"], user["l_name"]));
    };

    self.task_name = function (task_key) {
        var task = DataStore.tasks[task_key];
        return escapeHTML(task === undefined ? task_key : task["name"]);
    };

    self.solved_rows = function () {
        var keys = self.task_keys();
        var users = [];
        for (var id in DataStore.users) {
            users.push({
                key: id,
                solved: PerspectivesMetricsLogic.countSolved(DataStore.users[id], keys)
            });
        }
        users.sort(function (left, right) {
            return (right.solved - left.solved) ||
                (DataStore.users[right.key]["global"] - DataStore.users[left.key]["global"]);
        });
        return users;
    };

    self.render_solved = function () {
        var keys = self.task_keys();
        var users = self.solved_rows();
        var body = [];
        for (var index = 0; index < users.length; index += 1) {
            body.push([
                index + 1,
                self.name(users[index].key),
                users[index].solved + " / " + keys.length,
                round_to_str(DataStore.users[users[index].key]["global"],
                    DataStore.global_score_precision)
            ]);
        }
        $("#Persp_metrics_solved").html(
            PerspectiveViews.table(["Rank", "Name", "Solved", "Score"], body));
    };

    self.render_medals = function () {
        var users = PerspectiveViews.users_by_score();
        var body = [];
        for (var index = 0; index < users.length; index += 1) {
            var medal = PerspectivesMetricsLogic.classifyMedal(users[index]["rank"], self.medals);
            body.push([
                users[index]["rank"],
                self.name(users[index]["key"]),
                round_to_str(users[index]["global"], DataStore.global_score_precision),
                medal === null ? "" : medal.charAt(0).toUpperCase() + medal.slice(1)
            ]);
        }
        $("#Persp_metrics_medals").html(
            PerspectiveViews.table(["Rank", "Name", "Score", "Medal"], body));
    };

    self.render_first_blood = function () {
        var first = PerspectivesMetricsLogic.firstBlood(HistoryStore.history_t || []);
        var rows = [];
        for (var task in first) {
            rows.push({ task: task, user: first[task].user, time: first[task].time });
        }
        rows.sort(function (left, right) { return left.time - right.time; });
        var body = [];
        for (var index = 0; index < rows.length; index += 1) {
            body.push([
                index + 1,
                self.task_name(rows[index].task),
                self.name(rows[index].user),
                format_time(rows[index].time - PerspectiveTime.span().begin, true)
            ]);
        }
        $("#Persp_metrics_first").html(
            PerspectiveViews.table(["#", "Task", "First solver", "At"], body));
    };

    self.render_activity = function () {
        var items = "";
        for (var index = 0; index < self.activity.length; index += 1) {
            var hit = self.activity[index];
            items += '<li class="persp-metrics-hit">' + self.name(hit.user) + " \u00b7 " +
                self.task_name(hit.task) + " \u00b7 +" +
                round_to_str(hit.gained, DataStore.global_score_precision) + "</li>";
        }
        $("#Persp_metrics_activity").html(items);
    };

    self.render = function () {
        if (self.$el === null) {
            return;
        }
        self.render_solved();
        self.render_medals();
        self.render_first_blood();
        self.render_activity();
    };

    self.push_activity = function (user_key, task_key, gained) {
        if (gained <= 0) {
            return;
        }
        self.activity.unshift({ user: user_key, task: task_key, gained: gained });
        if (self.activity.length > self.ACTIVITY_LIMIT) {
            self.activity.pop();
        }
        self.render_activity();
    };

    self.controls = function () {
        return '<div class="persp-metrics">' +
            "<h3>Solved</h3><div id=\"Persp_metrics_solved\"></div>" +
            "<h3>Medals</h3><div id=\"Persp_metrics_medals\"></div>" +
            "<h3>First blood</h3><div id=\"Persp_metrics_first\"></div>" +
            "<h3>Activity</h3><ul id=\"Persp_metrics_activity\" class=\"persp-metrics-activity\"></ul>" +
            "</div>";
    };

    self.mount = function ($container, options) {
        self.$el = $container;
        self.medals = PerspectivesMetricsLogic.normaliseMedals(options);
        self.$el.html(self.controls());
        DataStore.score_events.add(function (user_key, user, task_key, task, gained) {
            self.push_activity(user_key, task_key, gained);
        });
        HistoryStore.request_update(function () {
            self.activity = PerspectivesMetricsLogic.recentGains(
                HistoryStore.history_t, self.ACTIVITY_LIMIT);
            self.render();
        });
    };

    self.refresh = function () {
        self.render();
    };
};

Perspectives.register("metrics", function () {
    return {
        label: "Metrics",
        mount: PerspectiveMetrics.mount,
        refresh: PerspectiveMetrics.refresh
    };
});
