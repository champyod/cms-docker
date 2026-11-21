/* Pure analysis helpers for the analysis perspective. */

(function (root, factory) {
    var logic = typeof module === "object" && module.exports
        ? require("./Perspectives.logic.js")
        : root.PerspectivesLogic;
    var api = factory(logic);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.PerspectivesAnalysisLogic = api;
    }
}(typeof self !== "undefined" ? self : this, function (PerspectivesLogic) {
    /* One row per key, summing the value every column contributes; a key with no
       column seen still gets a zeroed row so the grid stays rectangular. */
    function sumMatrix(entries, rowKeyOf, columnKeys, valueOf) {
        var table = {};
        for (var index = 0; index < entries.length; index += 1) {
            var entry = entries[index];
            var key = rowKeyOf(entry);
            if (key === null || key === undefined) {
                continue;
            }
            if (table[key] === undefined) {
                table[key] = emptyRow(columnKeys);
            }
            for (var column = 0; column < columnKeys.length; column += 1) {
                table[key][columnKeys[column]] += valueOf(entry, columnKeys[column]);
            }
        }
        return table;
    }

    function emptyRow(columnKeys) {
        var row = {};
        for (var index = 0; index < columnKeys.length; index += 1) {
            row[columnKeys[index]] = 0;
        }
        return row;
    }

    /* Every user's rank at each sampled moment, so a bump chart draws its places
       without recomputing a board per point. */
    function ranksOverTime(seriesByUser, times) {
        var result = [];
        for (var index = 0; index < times.length; index += 1) {
            var board = PerspectivesLogic.boardAt(seriesByUser, times[index]);
            var entries = [];
            for (var user in board) {
                entries.push({ key: user, value: board[user] });
            }
            var ranked = PerspectivesLogic.assignRanks(entries, function (entry) {
                return entry.value;
            });
            var ranks = {};
            for (var position = 0; position < ranked.length; position += 1) {
                ranks[ranked[position].key] = ranked[position].rank;
            }
            result.push({ time: times[index], ranks: ranks });
        }
        return result;
    }

    /* The last pace carried to `toTime`: the score a user reaches if they keep
       gaining at the rate between their last two samples. */
    function projectScore(series, toTime) {
        if (series.length === 0) {
            return 0;
        }
        var last = series[series.length - 1];
        if (series.length === 1 || last[0] >= toTime) {
            return last[1];
        }
        var previous = series[series.length - 2];
        var span = last[0] - previous[0];
        if (span <= 0) {
            return last[1];
        }
        var rate = (last[1] - previous[1]) / span;
        return last[1] + rate * (toTime - last[0]);
    }

    /* Two users' scores side by side on every task, with the difference. */
    function compareTasks(leftKey, rightKey, taskKeys, valueOf) {
        var rows = [];
        for (var index = 0; index < taskKeys.length; index += 1) {
            var task = taskKeys[index];
            var left = valueOf(leftKey, task);
            var right = valueOf(rightKey, task);
            rows.push({ task: task, left: left, right: right, delta: left - right });
        }
        return rows;
    }

    return {
        sumMatrix: sumMatrix,
        ranksOverTime: ranksOverTime,
        projectScore: projectScore,
        compareTasks: compareTasks
    };
}));
