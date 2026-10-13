const test = require("node:test");
const assert = require("node:assert/strict");

const logic = require("../Perspectives.group.logic.js");

function users() {
    return [
        { key: "u1", team: "th", global: 10, f_name: "A", l_name: "One" },
        { key: "u2", team: "th", global: 5, f_name: "B", l_name: "Two" },
        { key: "u3", team: "sg", global: 20, f_name: "C", l_name: "Three" },
        { key: "u4", team: null, global: 50, f_name: "D", l_name: "Four" }
    ];
}

function byKey(rows) {
    const map = {};
    rows.forEach((row) => {
        map[row.key] = row;
    });
    return map;
}

test("aggregateByGroup sums each team and ranks by the total", () => {
    const rows = logic.aggregateByGroup(
        users(),
        (item) => item.team,
        (item) => item.global,
        (item) => item.global,
        (key) => key.toUpperCase()
    );
    const map = byKey(rows);
    assert.equal(map.th.value, 15);
    assert.equal(map.sg.value, 20);
    assert.equal(map.sg.rank, 1);
    assert.equal(map.th.rank, 2);
    assert.equal(map.th.name, "TH");
    assert.equal(map.th.members.length, 2);
});

test("aggregateByGroup drops an item with no group key", () => {
    const rows = logic.aggregateByGroup(
        users(),
        (item) => item.team,
        (item) => item.global,
        (item) => item.global,
        (key) => key
    );
    assert.equal(rows.length, 2);
});

test("aggregateByGroup orders each group's members by score", () => {
    const rows = byKey(logic.aggregateByGroup(
        users(),
        (item) => item.team,
        (item) => item.global,
        (item) => item.global,
        (key) => key
    ));
    assert.deepEqual(rows.th.members.map((member) => member.key), ["u1", "u2"]);
});

test("ties share a rank and the next distinct total skips it", () => {
    const items = [
        { key: "u1", team: "a", global: 5 },
        { key: "u2", team: "b", global: 5 },
        { key: "u3", team: "c", global: 1 }
    ];
    const map = byKey(logic.aggregateByGroup(
        items,
        (item) => item.team,
        (item) => item.global,
        (item) => item.global,
        (key) => key
    ));
    assert.equal(map.a.rank, 1);
    assert.equal(map.b.rank, 1);
    assert.equal(map.c.rank, 3);
});

test("sortMembers orders members by score without mutating the input", () => {
    const input = users();
    const sorted = logic.sortMembers(input, (item) => item.global);
    assert.deepEqual(sorted.map((item) => item.key), ["u4", "u3", "u1", "u2"]);
    assert.equal(input[0].key, "u1");
});
