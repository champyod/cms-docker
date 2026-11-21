const test = require("node:test");
const assert = require("node:assert/strict");

const logic = require("../Perspectives.analysis.logic.js");

test("sumMatrix totals every column of each row", () => {
    const entries = [
        { team: "a", t1: 2, t2: 1 },
        { team: "a", t1: 3 },
        { team: "b", t1: 1 }
    ];
    const table = logic.sumMatrix(
        entries,
        (entry) => entry.team,
        ["t1", "t2"],
        (entry, column) => entry[column] || 0
    );
    assert.equal(table.a.t1, 5);
    assert.equal(table.a.t2, 1);
    assert.equal(table.b.t1, 1);
    assert.equal(table.b.t2, 0);
});

test("sumMatrix drops an entry with no row key", () => {
    const table = logic.sumMatrix(
        [{ team: null, t1: 4 }],
        (entry) => entry.team,
        ["t1"],
        (entry, column) => entry[column] || 0
    );
    assert.deepEqual(Object.keys(table), []);
});

test("ranksOverTime ranks each sampled moment from the series", () => {
    const series = {
        u1: [[10, 1], [20, 9]],
        u2: [[10, 8], [20, 8]]
    };
    const samples = logic.ranksOverTime(series, [10, 20]);
    assert.equal(samples[0].ranks.u2, 1);
    assert.equal(samples[0].ranks.u1, 2);
    assert.equal(samples[1].ranks.u1, 1);
    assert.equal(samples[1].ranks.u2, 2);
});

test("projectScore extends the last pace to the target moment", () => {
    assert.equal(logic.projectScore([[10, 5], [20, 9]], 30), 13);
});

test("projectScore returns the last score for one point or a past target", () => {
    assert.equal(logic.projectScore([[10, 5]], 60), 5);
    assert.equal(logic.projectScore([[10, 5], [20, 9]], 15), 9);
    assert.equal(logic.projectScore([], 60), 0);
});

test("compareTasks reports both scores and their difference", () => {
    const values = { u1: { t1: 5, t2: 0 }, u2: { t1: 2, t2: 3 } };
    const rows = logic.compareTasks("u1", "u2", ["t1", "t2"], (key, task) => values[key][task]);
    assert.deepEqual(rows[0], { task: "t1", left: 5, right: 2, delta: 3 });
    assert.deepEqual(rows[1], { task: "t2", left: 0, right: 3, delta: -3 });
});
