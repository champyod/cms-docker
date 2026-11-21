const test = require("node:test");
const assert = require("node:assert/strict");

const logic = require("../solve-rate-chart.logic.js");

test("hsvToHex wraps the hue and pads each channel", () => {
    assert.match(logic.hsvToHex(0, 0.42, 0.96), /^#[0-9a-f]{6}$/);
    assert.equal(logic.hsvToHex(0, 0.42, 0.96), logic.hsvToHex(360, 0.42, 0.96));
    assert.equal(logic.hsvToHex(-90, 0.42, 0.96), logic.hsvToHex(270, 0.42, 0.96));
});

test("makePalette returns one distinct colour per entry and honours defaults", () => {
    const palette = logic.makePalette(4);
    assert.equal(palette.length, 4);
    assert.equal(new Set(palette).size, 4);
    assert.deepEqual(logic.makePalette(4, { saturation: 0.42, value: 0.96, hueOffset: 0 }), palette);
});

test("normaliseTasks defaults a missing or bad max and stringifies the id", () => {
    const tasks = logic.normaliseTasks([{ id: 7 }, { id: "B", name: "Bee", max: 0 }, "C"], 100);
    assert.deepEqual(tasks, [
        { id: "7", name: "7", max: 100 },
        { id: "B", name: "Bee", max: 100 },
        { id: "C", name: "C", max: 100 }
    ]);
});

test("normaliseUsers keeps only positive finite scores and keeps the raw row", () => {
    const tasks = logic.normaliseTasks([{ id: "A", max: 100 }], 100);
    const raw = { id: "u1", scores: { A: -5 } };
    const users = logic.normaliseUsers([raw], tasks);
    assert.equal(users[0].scores.A, 0);
    assert.equal(users[0].raw, raw);
    assert.equal(users[0].id, "u1");
});

test("computeStats splits full, partial and zero and respects the filter", () => {
    const tasks = logic.normaliseTasks([{ id: "A", max: 100 }], 100);
    const users = logic.normaliseUsers(
        [{ id: "a", scores: { A: 100 } }, { id: "b", scores: { A: 50 } }, { id: "c", scores: { A: 0 } }],
        tasks
    );
    const all = logic.computeStats(tasks, users, null);
    assert.deepEqual(all[0], { task: tasks[0], n: 3, full: 1, partial: 1, zero: 1 });
    const filtered = logic.computeStats(tasks, users, (u) => u.id !== "c");
    assert.equal(filtered[0].n, 2);
    assert.equal(filtered[0].zero, 0);
});

test("segsOf lays the three segments end to end across the width", () => {
    const segs = logic.segsOf({ n: 4, full: 2, partial: 1, zero: 1 }, 400);
    assert.deepEqual(segs.map((s) => s.key), ["full", "partial", "zero"]);
    assert.deepEqual(segs.map((s) => s.w), [200, 100, 100]);
    assert.deepEqual(segs.map((s) => s.x), [0, 200, 300]);
});

test("segsOf gives zero width when there are no participants", () => {
    const segs = logic.segsOf({ n: 0, full: 0, partial: 0, zero: 0 }, 400);
    assert.deepEqual(segs.map((s) => s.w), [0, 0, 0]);
});

test("pct rounds and guards a zero total", () => {
    assert.equal(logic.pct(1, 3), 33);
    assert.equal(logic.pct(5, 0), 0);
});

test("esc escapes every html-significant character", () => {
    assert.equal(logic.esc('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});
