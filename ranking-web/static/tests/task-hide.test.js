const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * A task hide is an override, and the board's column set has to follow it. The hidden task
 * keeps its projection row, so nothing deletes it from the page's store: the list the page
 * loads at start-up already leaves it out, and an already-open board has to leave it out on
 * the same event a user hide travels on — the override change. These tests drive the real
 * browser files in a vm context, where the board redraws through the store.
 */
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

/** One contest with two 100-point tasks and one contestant, and no override yet. */
function seedBoard(store) {
    store.create_contest("c0", { name: "Contest", begin: 0, end: 100, score_precision: 0 });
    store.create_task("t0", {
        contest: "c0", name: "A Plus B", short_name: "aplusb", max_score: 100,
        score_precision: 0, extra_headers: [], order: 0
    });
    store.create_task("t1", {
        contest: "c0", name: "Circles", short_name: "circles", max_score: 100,
        score_precision: 0, extra_headers: [], order: 1
    });
    store.create_user("u0", { f_name: "Ada", l_name: "Lovelace", team: null });
}

function hideTask(store, key) {
    store.set_overrides([{ target_kind: "task", target_key: key, action: "hide", value: null }]);
}

test("a task hidden after the load leaves the board on the override event", () => {
    const { store, scoreboard, errors } = loadBoard();
    scoreboard.init();
    seedBoard(store);
    const board = function () {
        return scoreboard.make_cols() + scoreboard.make_head() + scoreboard.make_row(store.users["u0"]);
    };
    assert.ok(board().includes('data-task="t0"'), "the task starts as a column");

    hideTask(store, "t0");

    assert.equal(store.is_task_hidden("t0"), true, "the override hides the task");
    assert.ok(store.tasks["t0"] !== undefined, "the hidden task keeps its row and metadata");
    assert.ok(!board().includes('data-task="t0"'), board());
    assert.ok(board().includes('data-task="t1"'), "an unhidden task keeps its column");
    assert.deepEqual(errors, []);
});

test("a task hidden after the load leaves the ledger's numbers alone", () => {
    const { store, scoreboard, errors } = loadBoard();
    scoreboard.init();
    seedBoard(store);
    store.set_score("u0", "t0", 30.0);
    store.set_score("u0", "t1", 50.0);
    hideTask(store, "t0");

    store.set_score("u0", "t0", 0.0);

    assert.equal(store.users["u0"]["global"], 50.0, "the zeroed task adds nothing");
    assert.equal(store.users["u0"]["c_c0"], 50.0, "the contest total leaves it out");
    assert.ok(!scoreboard.make_row(store.users["u0"]).includes('data-task="t0"'), "its cell is gone");
    assert.deepEqual(errors, []);
});

test("a task the panel stops hiding gets its column back", () => {
    const { store, scoreboard } = loadBoard();
    scoreboard.init();
    seedBoard(store);
    hideTask(store, "t0");
    const hidden = scoreboard.make_cols();

    store.set_overrides([]);

    assert.equal(store.is_task_hidden("t0"), false);
    assert.ok(!hidden.includes('data-task="t0"'), "the column was gone");
    assert.ok(scoreboard.make_cols().includes('data-task="t0"'), "the column comes back");
    assert.ok(scoreboard.make_head().includes('data-task="t0"'), "the head comes back with it");
});

test("every board task list is read through the hiding-aware helper", () => {
    const source = fs.readFileSync(path.join(STATIC_DIR, "Scoreboard.js"), "utf8");

    assert.ok(
        !/var tasks = contest\["tasks"\]/.test(source),
        'a board task list is read straight off the contest, which keeps a hidden task\'s column drawn',
    );
});
