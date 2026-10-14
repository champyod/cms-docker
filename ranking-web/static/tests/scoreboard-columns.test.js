const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The scoreboard's column widths live in two files that must agree: Scoreboard.js builds
 * the <colgroup> and the first row's cells, and Ranking.css sizes the columns. Under
 * `table-layout: fixed` a <col> with `span` is given its `width` once per spanned column,
 * so folding a name into a single spanned <col> multiplies the declared width by the span
 * and starves the auto-width task columns. These assertions keep the name fields one column
 * each, so the width in Ranking.css is the width the name field actually gets.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "Scoreboard.js"), "utf8");
const STYLE = fs.readFileSync(path.join(__dirname, "..", "Ranking.css"), "utf8");

const NAME_FIELDS = ["f_name", "l_name"];

/** The lines that build a name field's <col>, matched on the class attribute exactly. */
function colLines(field) {
    return SOURCE.split("\n").filter((line) => line.includes(`<col class=\\"${field}\\"`));
}

/** The one line that builds a name field's header or body cell. */
function cellLine(tag, field) {
    return SOURCE.split("\n").find((line) => line.includes(`<${tag}`) && line.includes(`class=\\"${field}\\"`));
}

test("each name field is a single <col/>, never a spanned one", () => {
    for (const field of NAME_FIELDS) {
        const lines = colLines(field);
        assert.equal(lines.length, 1, `expected exactly one <col> for ${field}, found ${lines.length}`);
        assert.ok(!/span=/.test(lines[0]), `${field} is spanned, which multiplies its CSS width by the span: ${lines[0].trim()}`);
    }
});

test("a name header or cell declares no colspan", () => {
    for (const field of NAME_FIELDS) {
        for (const tag of ["th", "td"]) {
            const line = cellLine(tag, field);
            assert.ok(line, `no ${tag} for ${field}`);
            assert.ok(!/colspan=/.test(line), `${tag}.${field} spans extra columns the colgroup does not: ${line.trim()}`);
        }
    }
});

test("the stylesheet gives the name columns an explicit width", () => {
    assert.match(
        STYLE,
        /#Scoreboard_cols col\.f_name,\s*#Scoreboard_cols col\.l_name\s*\{[^}]*width:/,
        "the name columns have no explicit width, so they fall back to auto and absorb the table",
    );
});
