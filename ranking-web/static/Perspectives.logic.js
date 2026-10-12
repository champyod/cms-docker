/* Pure layout and aggregation helpers for the perspective tabs, free of the DOM. */

(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.PerspectivesLogic = api;
    }
}(typeof self !== "undefined" ? self : this, function () {
    var OVERFLOW_POLICIES = ["wrap", "scroll", "menu"];

    /* How the tab bar lays its tabs out. `firstHidden` is the index of the first
       tab that does not fit on one row; it is the tabs' length when nothing is
       hidden (wrap and scroll keep every tab reachable), and it is 0 when even
       the first tab does not fit. */
    function chooseOverflow(availableWidth, tabWidths, policy) {
        if (OVERFLOW_POLICIES.indexOf(policy) === -1) {
            policy = "wrap";
        }
        var firstHidden = tabWidths.length;
        var used = 0;
        for (var index = 0; index < tabWidths.length; index += 1) {
            if (used + tabWidths[index] <= availableWidth) {
                used += tabWidths[index];
            } else {
                firstHidden = index;
                break;
            }
        }
        if (policy === "menu") {
            return { mode: "menu", firstHidden: firstHidden };
        }
        return { mode: policy, firstHidden: tabWidths.length };
    }

    /* Groups items by a key and sums a value, keeping the members of each group
       so a team row can expand to the users it was built from. */
    function sumBy(items, keyOf, valueOf) {
        var groups = {};
        for (var index = 0; index < items.length; index += 1) {
            var item = items[index];
            var key = keyOf(item);
            if (key === null || key === undefined) {
                continue;
            }
            if (groups[key] === undefined) {
                groups[key] = { key: key, value: 0, members: [] };
            }
            groups[key].value += valueOf(item);
            groups[key].members.push(item);
        }
        return Object.keys(groups).map(function (key) {
            return groups[key];
        });
    }

    /* Competition ranking: equal values share a rank and the next distinct value
       skips the ties, matching the scoreboard's own rule. */
    function assignRanks(entries, valueOf) {
        var ordered = entries.slice().sort(function (left, right) {
            return valueOf(right) - valueOf(left);
        });
        var rank = 0;
        var previous = null;
        for (var index = 0; index < ordered.length; index += 1) {
            var value = valueOf(ordered[index]);
            if (previous === null || value !== previous) {
                rank = index + 1;
                previous = value;
            }
            ordered[index].rank = rank;
        }
        return ordered;
    }

    /* The board as of a moment: replay a (user, task, time, score) history up to
       `time` and sum each user's latest score per task. History arrives sorted by
       time, so a later entry for a pair simply overwrites the earlier one. */
    function boardAtTime(history, time) {
        var perUser = {};
        for (var index = 0; index < history.length; index += 1) {
            var entry = history[index];
            if (entry[2] > time) {
                continue;
            }
            var user = entry[0];
            if (perUser[user] === undefined) {
                perUser[user] = {};
            }
            perUser[user][entry[1]] = entry[3];
        }
        var totals = {};
        Object.keys(perUser).forEach(function (user) {
            var sum = 0;
            var tasks = perUser[user];
            Object.keys(tasks).forEach(function (task) {
                sum += tasks[task];
            });
            totals[user] = sum;
        });
        return totals;
    }

    /* Score gained in each fixed-size window of a contest, so a view can show an
       interval strip without recomputing the whole history per bucket. */
    function intervalGains(history, begin, end, bucketSeconds) {
        var buckets = [];
        if (bucketSeconds <= 0 || end <= begin) {
            return buckets;
        }
        var count = Math.ceil((end - begin) / bucketSeconds);
        for (var index = 0; index < count; index += 1) {
            buckets.push({ begin: begin + index * bucketSeconds, gains: {} });
        }
        var previous = {};
        var ordered = history.slice().sort(function (left, right) {
            return left[2] - right[2];
        });
        for (var position = 0; position < ordered.length; position += 1) {
            var entry = ordered[position];
            if (entry[2] < begin || entry[2] > end) {
                continue;
            }
            var bucket = Math.min(count - 1, Math.floor((entry[2] - begin) / bucketSeconds));
            var key = entry[0] + "\u0000" + entry[1];
            var gained = entry[3] - (previous[key] === undefined ? 0 : previous[key]);
            previous[key] = entry[3];
            if (gained > 0) {
                buckets[bucket].gains[entry[0]] = (buckets[bucket].gains[entry[0]] || 0) + gained;
            }
        }
        return buckets;
    }

    /* Counts of values across `buckets` equal-width bins up to `max`, the shape a
       distribution view draws. */
    function histogram(values, buckets, max) {
        var counts = [];
        for (var index = 0; index <= buckets; index += 1) {
            counts.push(0);
        }
        if (buckets <= 0 || max <= 0) {
            return counts;
        }
        for (var position = 0; position < values.length; position += 1) {
            var slot = Math.floor(values[position] / max * buckets);
            if (slot < 0) {
                slot = 0;
            }
            if (slot > buckets) {
                slot = buckets;
            }
            counts[slot] += 1;
        }
        return counts;
    }

    return {
        OVERFLOW_POLICIES: OVERFLOW_POLICIES,
        chooseOverflow: chooseOverflow,
        sumBy: sumBy,
        assignRanks: assignRanks,
        boardAtTime: boardAtTime,
        intervalGains: intervalGains,
        histogram: histogram
    };
}));
