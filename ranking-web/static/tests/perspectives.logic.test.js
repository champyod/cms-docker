const test = require("node:test");
const assert = require("node:assert/strict");

const logic = require("../Perspectives.logic.js");

test("a policy that is not one of the three falls back to wrap", () => {
    const chosen = logic.chooseOverflow(100, [50, 50], "nonsense");
    assert.equal(chosen.mode, "wrap");
});

test("wrap keeps every tab reachable however many there are", () => {
    const chosen = logic.chooseOverflow(100, [40, 40, 40, 40], "wrap");
    assert.equal(chosen.mode, "wrap");
    assert.equal(chosen.firstHidden, 4);
});

test("scroll keeps every tab reachable and never hides one", () => {
    const chosen = logic.chooseOverflow(100, [40, 40, 40, 40], "scroll");
    assert.equal(chosen.mode, "scroll");
    assert.equal(chosen.firstHidden, 4);
});

test("menu hides the tabs past the first row", () => {
    const chosen = logic.chooseOverflow(100, [40, 40, 40, 40], "menu");
    assert.equal(chosen.mode, "menu");
    assert.equal(chosen.firstHidden, 2);
});

test("menu hides nothing when the whole row fits", () => {
    const chosen = logic.chooseOverflow(100, [40, 40], "menu");
    assert.equal(chosen.firstHidden, 2);
});

test("menu hides every tab when even the first does not fit", () => {
    const chosen = logic.chooseOverflow(10, [40, 40], "menu");
    assert.equal(chosen.firstHidden, 0);
});

test("a zero-width bar still wraps rather than dropping tabs", () => {
    const chosen = logic.chooseOverflow(0, [40, 40], "wrap");
    assert.equal(chosen.firstHidden, 2);
});

test("sumBy groups and sums, keeping each group's members", () => {
    const items = [
        { team: "a", score: 10 },
        { team: "b", score: 5 },
        { team: "a", score: 2 }
    ];
    const groups = logic.sumBy(
        items,
        (item) => item.team,
        (item) => item.score
    );
    const byKey = {};
    groups.forEach((group) => {
        byKey[group.key] = group;
    });
    assert.equal(byKey.a.value, 12);
    assert.equal(byKey.a.members.length, 2);
    assert.equal(byKey.b.value, 5);
});

test("sumBy drops an item with no group key", () => {
    const groups = logic.sumBy(
        [{ team: null, score: 3 }],
        (item) => item.team,
        (item) => item.score
    );
    assert.equal(groups.length, 0);
});

test("assignRanks shares a rank on a tie and skips the next", () => {
    const entries = [{ v: 10 }, { v: 10 }, { v: 7 }, { v: 1 }];
    const ranked = logic.assignRanks(entries, (entry) => entry.v);
    assert.deepEqual(
        ranked.map((entry) => entry.rank),
        [1, 1, 3, 4]
    );
});

test("boardAtTime sums the latest score per task up to the given moment", () => {
    const history = [
        ["u1", "t1", 10, 5],
        ["u2", "t1", 20, 8],
        ["u1", "t1", 30, 12],
        ["u1", "t2", 40, 7]
    ];
    assert.deepEqual(logic.boardAtTime(history, 25), { u1: 5, u2: 8 });
    assert.deepEqual(logic.boardAtTime(history, 45), { u1: 19, u2: 8 });
});

test("intervalGains attributes a gain to the window it lands in", () => {
    const history = [
        ["u1", "t1", 12, 5],
        ["u1", "t1", 65, 9]
    ];
    const buckets = logic.intervalGains(history, 0, 120, 60);
    assert.equal(buckets.length, 2);
    assert.equal(buckets[0].gains.u1, 5);
    assert.equal(buckets[1].gains.u1, 4);
});

test("histogram bins values and clamps the top into the last bucket", () => {
    const counts = logic.histogram([0, 5, 9, 10, 10], 5, 10);
    assert.equal(counts[0], 1);
    assert.equal(counts[2], 1);
    assert.equal(counts[counts.length - 1], 2);
});

test("histogram returns empty buckets for a non-positive max", () => {
    const counts = logic.histogram([1, 2], 3, 0);
    assert.deepEqual(counts, [0, 0, 0, 0]);
});

test("valueAt reads the last score at or before the moment", () => {
    const series = [
        [10, 5],
        [30, 12]
    ];
    assert.equal(logic.valueAt(series, 5), 0);
    assert.equal(logic.valueAt(series, 10), 5);
    assert.equal(logic.valueAt(series, 29), 5);
    assert.equal(logic.valueAt(series, 30), 12);
});

test("boardAt maps every user's score at the moment", () => {
    const series = { u1: [[10, 5]], u2: [[20, 8]] };
    assert.deepEqual(logic.boardAt(series, 15), { u1: 5, u2: 0 });
    assert.deepEqual(logic.boardAt(series, 25), { u1: 5, u2: 8 });
});

test("diffBoards reports the change per user, including one-sided users", () => {
    const before = { u1: 5, u2: 8 };
    const after = { u1: 9, u3: 4 };
    const byUser = {};
    logic.diffBoards(before, after).forEach((entry) => {
        byUser[entry.user] = entry;
    });
    assert.deepEqual(byUser.u1, { user: "u1", before: 5, after: 9, delta: 4 });
    assert.equal(byUser.u2.delta, -8);
    assert.equal(byUser.u3.delta, 4);
});
