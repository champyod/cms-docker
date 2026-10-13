/* Pure helpers for SolveRateChart: palette, data normalisation, stats and segment
 * geometry, free of the DOM so node's test runner can load them via require. */

(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.SolveRateChartLogic = api;
    }
}(typeof self !== "undefined" ? self : this, function () {
    var SEG_KEYS = ["full", "partial", "zero"];
    var SEG_LABEL = { full: "Full", partial: "Partial", zero: "None" };
    var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

    function hsvToHex(hue, saturation, value) {
        var h = ((hue % 360) + 360) % 360;
        var c = value * saturation;
        var hp = h / 60;
        var x = c * (1 - Math.abs((hp % 2) - 1));
        var rgb;
        if (hp < 1)      { rgb = [c, x, 0]; }
        else if (hp < 2) { rgb = [x, c, 0]; }
        else if (hp < 3) { rgb = [0, c, x]; }
        else if (hp < 4) { rgb = [0, x, c]; }
        else if (hp < 5) { rgb = [x, 0, c]; }
        else             { rgb = [c, 0, x]; }
        var m = value - c;
        var hex = rgb.map(function (channel) {
            var n = Math.round((channel + m) * 255);
            return (n < 16 ? "0" : "") + n.toString(16);
        }).join("");
        return "#" + hex;
    }

    function makePalette(count, options) {
        var o = options || {};
        var saturation = o.saturation != null ? o.saturation : 0.42;
        var value = o.value != null ? o.value : 0.96;
        var hueOffset = o.hueOffset != null ? o.hueOffset : 0;
        var out = [];
        for (var index = 0; index < count; index++) {
            out.push(hsvToHex(hueOffset + (index * 360) / count, saturation, value));
        }
        return out;
    }

    function pct(count, total) {
        return total ? Math.round((100 * count) / total) : 0;
    }

    function esc(value) {
        return String(value).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
    }

    function normaliseTasks(tasks, defaultMax) {
        return (tasks || []).map(function (task) {
            var o = (typeof task === "object" && task !== null) ? task : { id: task };
            var max = +o.max;
            return {
                id: String(o.id),
                name: o.name != null ? String(o.name) : String(o.id),
                max: isFinite(max) && max > 0 ? max : defaultMax
            };
        });
    }

    function normaliseUsers(users, tasks) {
        return (users || []).map(function (user, index) {
            var scores = {};
            tasks.forEach(function (task) {
                var score = +(user.scores && user.scores[task.id]) || 0;
                scores[task.id] = score > 0 && isFinite(score) ? score : 0;
            });
            var id = user.id != null ? user.id : index;
            return {
                id: String(id),
                name: user.name != null ? user.name : String(id),
                scores: scores,
                raw: user
            };
        });
    }

    function computeStats(tasks, users, filter) {
        var counted = filter ? users.filter(function (user) { return filter(user.raw); }) : users;
        return tasks.map(function (task) {
            var full = 0, partial = 0, zero = 0;
            counted.forEach(function (user) {
                var score = user.scores[task.id];
                if (score >= task.max) full++;
                else if (score > 0) partial++;
                else zero++;
            });
            return { task: task, n: counted.length, full: full, partial: partial, zero: zero };
        });
    }

    function segsOf(row, innerWidth) {
        var out = [];
        var acc = 0;
        SEG_KEYS.forEach(function (key) {
            var width = row.n ? (row[key] / row.n) * innerWidth : 0;
            out.push({ key: key, c: row[key], x: acc, w: width, row: row });
            acc += width;
        });
        return out;
    }

    return {
        SEG_KEYS: SEG_KEYS,
        SEG_LABEL: SEG_LABEL,
        hsvToHex: hsvToHex,
        makePalette: makePalette,
        pct: pct,
        esc: esc,
        normaliseTasks: normaliseTasks,
        normaliseUsers: normaliseUsers,
        computeStats: computeStats,
        segsOf: segsOf
    };
}));
