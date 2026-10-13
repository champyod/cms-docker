/* The time perspective: scrub to any moment, replay the contest, and compare a moment
 * against the live board. The score history comes from HistoryStore, which the page
 * already fetches for the per-user charts. */

var PerspectiveTime = new function () {
    var self = this;

    self.STEP_MS = 250;
    self.REPLAY_FRAMES = 60;

    self.$el = null;
    self.$slider = null;
    self.series = {};
    self.time = 0;
    self.compare = false;
    self.replay_id = null;

    self.span = function () {
        var begin = null;
        var end = null;
        for (var key in DataStore.contests) {
            var contest = DataStore.contests[key];
            begin = begin === null ? contest["begin"] : Math.min(begin, contest["begin"]);
            end = end === null ? contest["end"] : Math.max(end, contest["end"]);
        }
        if (begin === null) {
            return { begin: 0, end: 1 };
        }
        return { begin: begin, end: Math.max(end, begin + 1) };
    };

    self.build_series = function () {
        var series = {};
        for (var u_id in DataStore.users) {
            series[u_id] = HistoryStore.get_score_history(u_id);
        }
        return series;
    };

    self.rank_of = function (board) {
        var entries = [];
        for (var u_id in DataStore.users) {
            entries.push({ key: u_id, score: board[u_id] || 0 });
        }
        return PerspectivesLogic.assignRanks(entries, function (entry) {
            return entry.score;
        });
    };

    self.rows = function (time) {
        var board = PerspectivesLogic.boardAt(self.series, time);
        var ranked = self.rank_of(board);
        var now = self.compare ? self.rank_of(PerspectivesLogic.boardAt(self.series, self.span().end)) : null;
        var now_by_key = {};
        if (now !== null) {
            for (var index = 0; index < now.length; index += 1) {
                now_by_key[now[index].key] = now[index];
            }
        }
        var body = [];
        for (var position = 0; position < ranked.length; position += 1) {
            var entry = ranked[position];
            var cells = [
                entry.rank,
                escapeHTML(Perspectives.display_name(DataStore.users[entry.key]["f_name"],
                    DataStore.users[entry.key]["l_name"])),
                round_to_str(entry.score, DataStore.global_score_precision)
            ];
            if (now !== null) {
                var after = now_by_key[entry.key];
                cells.push(self.signed(entry.score - after.score, DataStore.global_score_precision));
                cells.push(self.signed(entry.rank - after.rank, 0));
            }
            body.push(cells);
        }
        return body;
    };

    self.signed = function (value, precision) {
        if (value === 0) {
            return "0";
        }
        return (value > 0 ? "+" : "") + round_to_str(value, precision);
    };

    self.render = function () {
        var headers = ["Rank", "Name", "Score"];
        if (self.compare) {
            headers.push("\u0394 Score", "\u0394 Rank");
        }
        self.$el.find("#Persp_time_table").html(PerspectiveViews.table(headers, self.rows(self.time)));
        self.$el.find("#Persp_time_clock").text(format_time(self.time - self.span().begin, true));
    };

    self.stop_replay = function () {
        if (self.replay_id !== null) {
            window.clearInterval(self.replay_id);
            self.replay_id = null;
        }
    };

    self.start_replay = function () {
        self.stop_replay();
        var span = self.span();
        var step = Math.max(1, Math.round((span.end - span.begin) / self.REPLAY_FRAMES));
        self.time = span.begin;
        self.$slider.val(self.time);
        self.render();
        self.replay_id = window.setInterval(function () {
            self.time += step;
            if (self.time >= span.end) {
                self.time = span.end;
                self.stop_replay();
            }
            self.$slider.val(self.time);
            self.render();
        }, self.STEP_MS);
    };

    self.controls = function () {
        var span = self.span();
        return '<div class="persp-time">' +
            '<input type="range" id="Persp_time_slider" min="' + span.begin + '" max="' + span.end +
            '" step="60" value="' + self.time + '" />' +
            '<span id="Persp_time_clock"></span>' +
            '<button type="button" class="persp-time-btn" id="Persp_time_live">Live</button>' +
            '<button type="button" class="persp-time-btn" id="Persp_time_replay">Replay</button>' +
            '<label class="persp-time-compare"><input type="checkbox" id="Persp_time_diff" /> Compare with now</label>' +
            "</div>" + '<div id="Persp_time_table"></div>';
    };

    self.bind = function () {
        self.$slider = self.$el.find("#Persp_time_slider");
        self.$slider.on("input", function () {
            self.stop_replay();
            self.time = parseInt($(this).val(), 10);
            self.render();
        });
        self.$el.find("#Persp_time_live").on("click", function () {
            self.stop_replay();
            self.time = self.span().end;
            self.$slider.val(self.time);
            self.render();
        });
        self.$el.find("#Persp_time_replay").on("click", self.start_replay);
        self.$el.find("#Persp_time_diff").on("change", function () {
            self.compare = $(this).is(":checked");
            self.render();
        });
    };

    self.mount = function ($container) {
        self.$el = $container;
        self.$el.html(self.controls());
        self.bind();
        HistoryStore.request_update(function () {
            self.series = self.build_series();
            self.time = self.span().end;
            self.$slider.val(self.time);
            self.render();
        });
    };

    self.refresh = function () {
        if (self.$el !== null) {
            self.render();
        }
    };
};

Perspectives.register("time", function () {
    return {
        label: "Time",
        mount: PerspectiveTime.mount,
        refresh: PerspectiveTime.refresh
    };
});
