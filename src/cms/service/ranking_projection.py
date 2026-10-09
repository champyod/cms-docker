"""Turn proxy payloads into rows of the ranking projection tables.

WHY this module imports nothing from cms: the mapping is the only part of the push
path worth testing in isolation, and importing cms builds the configuration at import
time, which drags in the whole service dependency set. Keeping it dependency-free means
the mapping can be tested with a bare interpreter.

WHY a projection and not the old HTTP store: the scoreboard reads these tables, so the
push and the read share one storage and one transaction boundary. The payload shape is
unchanged, which is what lets the mapping be a rename rather than a translation.
"""

import json
from typing import Any, Iterable

# The plural resource names ProxyService already uses as its type order.
TABLES = {
    "contests": "ranking_contests",
    "tasks": "ranking_tasks",
    "teams": "ranking_teams",
    "users": "ranking_users",
    "submissions": "ranking_submissions",
    "subchanges": "ranking_subchanges",
}

# Column order per table, taken from the Prisma models. `order` is a reserved word in
# SQL, so the column is display_order and the payload name is kept for the wire.
COLUMNS = {
    "contests": ("key", "name", "begin", "end", "score_precision"),
    "tasks": (
        "key", "name", "short_name", "contest", "max_score",
        "score_precision", "extra_headers", "display_order", "score_mode",
    ),
    "teams": ("key", "name"),
    "users": ("key", "f_name", "l_name", "team"),
    "submissions": ("key", "user", "task", "time"),
    "subchanges": ("key", "submission", "time", "score", "token", "extra"),
}

# The fields the wire format requires. A payload missing one is refused here rather
# than written as NULL and discovered later by a reader.
REQUIRED = {
    "contests": ("name", "begin", "end", "score_precision"),
    "tasks": (
        "name", "short_name", "contest", "max_score", "score_precision",
        "extra_headers", "order", "score_mode",
    ),
    "teams": ("name",),
    "users": ("f_name", "l_name"),
    "submissions": ("user", "task", "time"),
    "subchanges": ("submission", "time"),
}

JSON_COLUMNS = frozenset({"extra_headers", "extra"})

# Column name to the payload name it comes from, where the two differ.
PAYLOAD_NAMES = {"display_order": "order"}

KEY_COLUMN = "key"


def columns_for(resource: str) -> tuple:
    """The columns of a resource, or a refusal for a resource we do not know."""
    try:
        return COLUMNS[resource]
    except KeyError:
        raise ValueError("unknown ranking resource: %s" % resource) from None


def upsert_statement(resource: str) -> str:
    """An ON CONFLICT upsert for one resource.

    WHY ON CONFLICT rather than a delete and insert: the proxy re-sends an entity
    whenever any of its fields change, so the same key arrives many times and must
    update in place. A jsonb column is cast explicitly because a bound string does not
    become jsonb on its own.
    """
    columns = columns_for(resource)
    binds = ", ".join(_bind(column) for column in columns)
    assignments = ", ".join(
        "%s = EXCLUDED.%s" % (column, column)
        for column in columns
        if column != KEY_COLUMN
    )
    update = " DO UPDATE SET %s" % assignments if assignments else " DO NOTHING"
    return "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s)%s" % (
        TABLES[resource], ", ".join(columns), binds, KEY_COLUMN, update,
    )


def row(resource: str, key: str, payload: dict) -> dict:
    """The bound parameters for one entity, or a refusal if the payload is short."""
    columns = columns_for(resource)
    missing = [name for name in REQUIRED[resource] if name not in payload]
    if missing:
        raise ValueError(
            "%s %s is missing %s" % (resource, key, ", ".join(sorted(missing)))
        )
    values: dict[str, Any] = {KEY_COLUMN: key}
    for column in columns:
        if column == KEY_COLUMN:
            continue
        value = payload.get(PAYLOAD_NAMES.get(column, column))
        # An absent optional jsonb field must be SQL NULL, not the JSON text
        # 'null': the two read the same in Python and differ in the column.
        if column in JSON_COLUMNS and value is not None:
            values[column] = json.dumps(value)
        else:
            values[column] = value
    return values


def rows(resource: str, payloads: dict) -> Iterable[dict]:
    """Every entity of one resource, in a stable order so a retry is repeatable."""
    for key in sorted(payloads):
        yield row(resource, key, payloads[key])


def _bind(column: str) -> str:
    if column in JSON_COLUMNS:
        return "CAST(:%s AS jsonb)" % column
    return ":%s" % column

