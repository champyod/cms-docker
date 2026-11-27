const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const STATIC_DIR = path.join(__dirname, "..");
function makeCallbacks() {
    const handlers = [];
    return {
        add: function (...added) {
            handlers.push(...added);
            return this;
        },
        fire: function (...args) {
            handlers.forEach((handler) => handler(...args));
            return this;
        }
    };
}

/** A chainable stand-in for the jQuery calls the two files make, the row node included. */
function makeJquery() {
    const element = {
        0: { node: true },
        ready: function () { return element; },
        on: function () { return element; },
        attr: function () { return element; },
        text: function () { return element; },
        data: function () { return undefined; },
        html: function () { return element; },
        empty: function () { return element; },
        append: function () { return element; },
        prepend: function () { return element; },
        children: function () { return element; },
        each: function () { return element; },
        before: function () { return element; },
        after: function () { return element; },
        addClass: function () { return element; },
        removeClass: function () { return element; },
        hasClass: function () { return false; }
    };
    function $(selector) {
        return element;
    }
    $.Callbacks = makeCallbacks;
    $.each = function () {};
    $.ajax = function () {};
    return $;
}

/** Loads DataStore.js and Scoreboard.js into a fresh context, recording console.error. */
function loadBoard() {
    const errors = [];
    const context = {
        $: makeJquery(),
        document: {
            body: {},
            createDocumentFragment: function () { return { appendChild: function () {} }; }
        },
        Config: {
            get_flag_url: function (team) { return "flags/" + team + ".png"; }
        },
        PublicConfig: { show_id_column: false },
        console: {
            log: function () {},
            info: function () {},
            error: function (message) { errors.push(String(message)); }
        }
    };
    vm.createContext(context);
    for (const file of ["DataStore.js", "Scoreboard.js"]) {
        const source = fs.readFileSync(path.join(STATIC_DIR, file), "utf8");
        vm.runInContext(source, context, { filename: file });
    }
    return { store: context.DataStore, scoreboard: context.Scoreboard, errors };
}

/**
 * Two contests share one page: the same user is one row per contest, a hide filed under
 * C1 leaves the C2 row standing, and a C2 rename does not rename the C1 row.
 */
test("one user is one row per shown contest and overrides stay in their contest", () => {
    const { store, scoreboard, errors } = loadBoard();
    store.create_contest("c0", { name: "Contest One", begin: 0, end: 100, score_precision: 0 });
    store.create_contest("c1", { name: "Contest Two", begin: 0, end: 100, score_precision: 0 });
    store.create_task("t0", { contest: "c0", name: "A", short_name: "A", max_score: 100, score_precision: 0, extra_headers: [], display_order: 0 });
    store.create_task("t1", { contest: "c1", name: "B", short_name: "B", max_score: 100, score_precision: 0, extra_headers: [], display_order: 1 });
    store.create_user("u0", { team: null, f_name: "Ada", l_name: "Lovelace", rank: "–" });
    store.set_score("u0", "t0", 10);
    store.set_score("u0", "t1", 20);

    let rows = scoreboard.visible_users();
    assert.equal(rows.length, 2, "the user has one row in each contest");
    assert.ok(rows.every((row) => row["row_id"] !== undefined));
    assert.ok(scoreboard.make_head().includes("Contest"), "the head carries the contest column");

    store.set_overrides([
        { contest: "c0", contest_id: 1, target_kind: "user", target_key: "u0", action: "hide", value: null },
        { contest: "c1", contest_id: 2, target_kind: "user", target_key: "u0", action: "rename", value: "Second Contest" }
    ]);
    rows = scoreboard.visible_users();
    assert.equal(rows.length, 1, "C1's hide removes only the C1 row");
    assert.equal(rows[0]["contest"], "c1");
    const html = scoreboard.make_row(rows[0]);
    assert.ok(html.includes("Second Contest"), "C2's rename reaches its own row");
    assert.ok(html.includes('data-row="u0|c1"'), "the row has a contest-scoped DOM id");
    assert.equal(errors.length, 0);
});
