/* The analysis perspective shell: a mode bar over six panels that each read the
 * live stores, so a score change redraws whichever analysis is on screen. */

var PerspectiveAnalysis = new function () {
    var self = this;

    self.SAMPLES = 48;
    self.MODES = [
        { id: "bump", label: "Bump" },
        { id: "heatmap", label: "Heatmap" },
        { id: "head", label: "Head to head" },
        { id: "distribution", label: "Distribution" },
        { id: "projection", label: "Projection" },
        { id: "matrix", label: "Matrix" }
    ];

    self.$el = null;
    self.mode = "bump";
    self.left = null;
    self.right = null;

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

    self.users = function () {
        return PerspectiveViews.users_by_score();
    };

    self.name = function (user_key) {
        var user = DataStore.users[user_key];
        if (user === undefined) {
            return escapeHTML(user_key);
        }
        return escapeHTML(Perspectives.display_name(user["f_name"], user["l_name"]));
    };

    self.task_label = function (task_key) {
        var task = DataStore.tasks[task_key];
        if (task === undefined) {
            return escapeHTML(task_key);
        }
        return escapeHTML(task["short_name"] || task["name"]);
    };

    self.team_label = function (team_key) {
        var team = DataStore.teams[team_key];
        return escapeHTML(team === undefined ? team_key : team["name"]);
    };

    self.precision = function () {
        return DataStore.global_score_precision;
    };

    self.series = function () {
        var series = {};
        var users = self.users();
        for (var index = 0; index < users.length; index += 1) {
            series[users[index].key] = HistoryStore.get_score_history(users[index].key);
        }
        return series;
    };

    self.sample_times = function () {
        var span = PerspectiveTime.span();
        var times = [];
        for (var index = 0; index <= self.SAMPLES; index += 1) {
            times.push(span.begin + (span.end - span.begin) * index / self.SAMPLES);
        }
        return times;
    };

    self.controls = function () {
        var buttons = "";
        for (var index = 0; index < self.MODES.length; index += 1) {
            var mode = self.MODES[index];
            buttons += '<button type="button" class="persp-analysis-mode" data-mode="' +
                mode.id + '">' + escapeHTML(mode.label) + "</button>";
        }
        return '<div class="persp-analysis-bar">' + buttons + "</div>" +
            '<div id="Persp_analysis_panel"></div>';
    };

    self.mark_active = function () {
        self.$el.find(".persp-analysis-mode").each(function () {
            $(this).toggleClass("active", $(this).data("mode") === self.mode);
        });
    };

    self.select_users = function () {
        var users = self.users();
        if (self.left === null && users.length > 0) {
            self.left = users[0].key;
        }
        if (self.right === null && users.length > 1) {
            self.right = users[1].key;
        }
    };

    self.render = function () {
        if (self.$el === null) {
            return;
        }
        PerspectiveAnalysisPanels[self.mode]($("#Persp_analysis_panel", self.$el), self);
    };

    self.mount = function ($container) {
        self.$el = $container;
        self.$el.html(self.controls());
        self.$el.on("click", ".persp-analysis-mode", function () {
            self.mode = $(this).data("mode");
            self.mark_active();
            self.render();
        });
        self.mark_active();
        HistoryStore.request_update(function () {
            self.select_users();
            self.render();
        });
    };

    self.refresh = function () {
        self.select_users();
        self.render();
    };
};

Perspectives.register("analysis", function () {
    return {
        label: "Analysis",
        mount: PerspectiveAnalysis.mount,
        refresh: PerspectiveAnalysis.refresh
    };
});
