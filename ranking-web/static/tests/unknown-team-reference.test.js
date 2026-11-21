const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/**
 * A user whose team the store does not hold is a data fault, not a dropped connection. The
 * create path already skips it, but the SSE update path and the scoreboard row build both
 * looked the team up unguarded, so one unknown reference threw out of the callback. These
 * tests drive the real browser files in a vm context, where a missing guard throws.
 */
const STATIC_DIR = path.join(__dirname, "..");

/** jQuery's $.Callbacks(): the browser files only add handlers and fire them. */
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

/** A chainable stand-in for the jQuery calls the two files make at load time. */
function makeJquery() {
    const element = {
        ready: function () { return element; },
        on: function () { return element; },
        attr: function () { return element; },
        text: function () { return element; },
        html: function () { return element; },
        addClass: function () { return element; },
        removeClass: function () { return element; }
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
function loadContext() {
    const errors = [];
    const context = {
        $: makeJquery(),
        document: { body: {} },
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

function seedUser(store) {
    store.create_team("t1", { name: "Good Team" });
    store.create_user("u1", { team: "t1", f_name: "Ann", l_name: "Bee", rank: "–" });
}

test("an update naming an unknown team is skipped, not thrown", () => {
    const { store, errors } = loadContext();
    seedUser(store);

    store.update_user("u1", { team: "gone", f_name: "Ann", l_name: "Bee", rank: "–" });

    assert.equal(store.users["u1"]["team"], "t1");
    assert.deepEqual(errors, ["Could not find team gone for user u1"]);
});

test("an update naming a known team still lands", () => {
    const { store, errors } = loadContext();
    seedUser(store);

    store.update_user("u1", { team: "t1", f_name: "Ann", l_name: "Cee", rank: "1" });

    assert.equal(store.users["u1"]["l_name"], "Cee");
    assert.deepEqual(errors, []);
});

test("a row for an unknown team falls back to the raw key", () => {
    const { scoreboard } = loadContext();
    const row = scoreboard.make_row({
        key: "u1", team: "gone", f_name: "Ann", l_name: "Bee", rank: "–", selected: 0
    });

    assert.ok(row.includes('title="gone"'), row);
});

test("a row for a known team shows the team's name", () => {
    const { store, scoreboard } = loadContext();
    store.create_team("t1", { name: "Good Team" });
    const row = scoreboard.make_row({
        key: "u1", team: "t1", f_name: "Ann", l_name: "Bee", rank: "–", selected: 0
    });

    assert.ok(row.includes('title="Good Team"'), row);
});

test("every team name in Scoreboard.js is read through the resolving helper", () => {
    const source = fs.readFileSync(path.join(STATIC_DIR, "Scoreboard.js"), "utf8");

    assert.ok(
        !/DataStore\.teams\[[^\]]*\]\["name"\]/.test(source),
        "a team name is read straight off DataStore.teams, which throws for an unknown team",
    );
});
