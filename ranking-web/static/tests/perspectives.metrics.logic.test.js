const test = require("node:test");
const assert = require("node:assert/strict");

const logic = require("../Perspectives.metrics.logic.js");

test("firstBlood names the earliest positive solver of each task", () => {
    const history = [
        ["u1", "t1", 30, 12],
        ["u2", "t1", 20, 8],
        ["u1", "t1", 10, 5],
        ["u3", "t2", 40, 0]
    ];
    const first = logic.firstBlood(history);
    assert.equal(first.t1.user, "u1");
    assert.equal(first.t1.time, 10);
    assert.equal(first.t2, undefined);
});

test("countSolved counts only tasks with a positive score", () => {
    const user = { t_a: 5, t_b: 0, t_c: 3, t_d: -1 };
    assert.equal(logic.countSolved(user, ["a", "b", "c", "d"]), 2);
});

test("countSolved reads a missing task as unsolved", () => {
    assert.equal(logic.countSolved({ t_a: 5 }, ["a", "b"]), 1);
});

test("classifyMedal respects each cutoff", () => {
    const cutoffs = { gold: 1, silver: 3, bronze: 6 };
    assert.equal(logic.classifyMedal(1, cutoffs), "gold");
    assert.equal(logic.classifyMedal(3, cutoffs), "silver");
    assert.equal(logic.classifyMedal(6, cutoffs), "bronze");
    assert.equal(logic.classifyMedal(7, cutoffs), null);
});

test("normaliseMedals defaults when the options carry none", () => {
    assert.deepEqual(logic.normaliseMedals(null), { gold: 1, silver: 2, bronze: 3 });
    assert.deepEqual(logic.normaliseMedals({}), { gold: 1, silver: 2, bronze: 3 });
});

test("normaliseMedals reads the panel's cutoffs and floors bad values", () => {
    const cutoffs = logic.normaliseMedals({ medals: { gold: 2, silver: 5.9, bronze: 0 } });
    assert.equal(cutoffs.gold, 2);
    assert.equal(cutoffs.silver, 5);
    assert.equal(cutoffs.bronze, 3);
    assert.equal(logic.normaliseMedals({ medals: { gold: "x" } }).gold, 1);
});

test("recentGains returns the newest positive gains first", () => {
    const history = [
        ["u1", "t1", 10, 5],
        ["u2", "t1", 20, 8],
        ["u1", "t1", 30, 12],
        ["u2", "t2", 40, 0]
    ];
    const gains = logic.recentGains(history, 2);
    assert.equal(gains.length, 2);
    assert.deepEqual(gains[0], { user: "u1", task: "t1", gained: 7 });
    assert.deepEqual(gains[1], { user: "u2", task: "t1", gained: 8 });
});

test("recentGains ignores an unchanged or lowered score", () => {
    const history = [
        ["u1", "t1", 10, 5],
        ["u1", "t1", 20, 5],
        ["u1", "t1", 30, 2]
    ];
    assert.equal(logic.recentGains(history, 10).length, 1);
});
