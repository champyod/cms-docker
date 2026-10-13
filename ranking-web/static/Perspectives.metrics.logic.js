/* Pure metric helpers for the metrics perspective. */

(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.PerspectivesMetricsLogic = api;
    }
}(typeof self !== "undefined" ? self : this, function () {
    var DEFAULT_MEDALS = { gold: 1, silver: 2, bronze: 3 };

    /* The earliest positive score per task names that task's first solver. */
    function firstBlood(history) {
        var first = {};
        for (var index = 0; index < history.length; index += 1) {
            var entry = history[index];
            if (entry[3] <= 0) {
                continue;
            }
            var known = first[entry[1]];
            if (known === undefined || entry[2] < known.time) {
                first[entry[1]] = { user: entry[0], time: entry[2] };
            }
        }
        return first;
    }

    /* How many of `taskKeys` a user holds a positive score on. */
    function countSolved(user, taskKeys) {
        var solved = 0;
        for (var index = 0; index < taskKeys.length; index += 1) {
            if (user["t_" + taskKeys[index]] > 0) {
                solved += 1;
            }
        }
        return solved;
    }

    /* The medal a competition rank earns, or null past the bronze cutoff. */
    function classifyMedal(rank, cutoffs) {
        if (rank <= cutoffs.gold) {
            return "gold";
        }
        if (rank <= cutoffs.silver) {
            return "silver";
        }
        if (rank <= cutoffs.bronze) {
            return "bronze";
        }
        return null;
    }

    function readPositive(value, fallback) {
        if (typeof value !== "number" || !isFinite(value) || value < 1) {
            return fallback;
        }
        return Math.floor(value);
    }

    /* The three rank cutoffs the panel configures, each falling back so a partial
       or mistyped options object still classifies every row. */
    function normaliseMedals(options) {
        var medals = options === null || options === undefined ? null : options.medals;
        if (typeof medals !== "object" || medals === null) {
            return {
                gold: DEFAULT_MEDALS.gold,
                silver: DEFAULT_MEDALS.silver,
                bronze: DEFAULT_MEDALS.bronze
            };
        }
        return {
            gold: readPositive(medals.gold, DEFAULT_MEDALS.gold),
            silver: readPositive(medals.silver, DEFAULT_MEDALS.silver),
            bronze: readPositive(medals.bronze, DEFAULT_MEDALS.bronze)
        };
    }

    /* The most recent score increases, newest first, so the ticker has a seed
       before any live event arrives. */
    function recentGains(history, limit) {
        var ordered = history.slice().sort(function (left, right) {
            return left[2] - right[2];
        });
        var previous = {};
        var gains = [];
        for (var index = 0; index < ordered.length; index += 1) {
            var entry = ordered[index];
            var key = entry[0] + "\u0000" + entry[1];
            var before = previous[key] === undefined ? 0 : previous[key];
            previous[key] = entry[3];
            if (entry[3] > before) {
                gains.push({ user: entry[0], task: entry[1], gained: entry[3] - before });
            }
        }
        gains.reverse();
        return limit >= 0 ? gains.slice(0, limit) : gains;
    }

    return {
        DEFAULT_MEDALS: DEFAULT_MEDALS,
        firstBlood: firstBlood,
        countSolved: countSolved,
        classifyMedal: classifyMedal,
        normaliseMedals: normaliseMedals,
        recentGains: recentGains
    };
}));
