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
from typing import Any, Iterable, Optional

# The plural resource names ProxyService already uses as its type order.
TABLES = {
    "contests": "ranking_contests",
    "tasks": "ranking_tasks",
    "teams": "ranking_teams",
    "users": "ranking_users",
    "submissions": "ranking_submissions",
    "subchanges": "ranking_subchanges",
    "hidden": "ranking_hidden",
}

# Column order per table, taken from the Prisma models. `order` is a reserved word in
# SQL, so the column is display_order and the payload name is kept for the wire.
COLUMNS = {
    "contests": ("key", "name", "begin", "end", "score_precision", "contest_id"),
    "tasks": (
        "key", "name", "short_name", "contest", "contest_id", "max_score",
        "score_precision", "extra_headers", "display_order", "score_mode",
    ),
    "teams": ("key", "name"),
    "users": ("key", "f_name", "l_name", "team"),
    "submissions": ("key", "user", "task", "time"),
    "subchanges": ("key", "submission", "time", "score", "token", "extra"),
    "hidden": ("key", "contest_id"),
}

# The fields the wire format requires. A payload missing one is refused here rather
# than written as NULL and discovered later by a reader.
REQUIRED = {
    "contests": ("name", "begin", "end", "score_precision", "contest_id"),
    "tasks": (
        "name", "short_name", "contest", "contest_id", "max_score", "score_precision",
        "extra_headers", "order", "score_mode",
    ),
    "teams": ("name",),
    "users": ("f_name", "l_name"),
    "submissions": ("user", "task", "time"),
    "subchanges": ("submission", "time"),
    "hidden": ("contest_id",),
}

JSON_COLUMNS = frozenset({"extra_headers", "extra"})

# WHY this set: an unquoted reserved word in a column list or assignment is a syntax
# error that refuses the whole push, not just the one row. `end` and `user` are reserved
# in Postgres. `begin` is not reserved in Postgres but is reserved in the SQL standard,
# and is quoted for that same safety. Quoting the identifier fixes it without renaming
# the column or the payload key, which the wire format and the scoreboard readers both
# depend on.
RESERVED = frozenset({"begin", "end", "user"})

# Column name to the payload name it comes from, where the two differ.
PAYLOAD_NAMES = {"display_order": "order"}

KEY_COLUMN = "key"

# The conflict target of an upsert, where a row is identified by more than the key alone.
# A hidden tombstone is one row per contest for the same user, so the pair identifies it.
CONFLICT_COLUMNS = {"hidden": ("key", "contest_id")}

# The snapshot resources a full push replaces, and the payload field that scopes the delete to
# the owner the push is about. Tasks and hidden tombstones qualify: a task and a tombstone each
# belong to exactly one contest, so a delete scoped by that field cannot reach another contest's
# rows. Teams and users are shared across contests and carry no owner field to scope by, and
# submissions and subchanges arrive incrementally, so all four stay upsert-only and a key
# dropped from their payload persists.
SNAPSHOT_SCOPE_FIELD = {"tasks": "contest", "hidden": "contest_id"}


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
    conflict_columns = CONFLICT_COLUMNS.get(resource, (KEY_COLUMN,))
    binds = ", ".join(_bind(column) for column in columns)
    # WHY the conflict columns stay out of the assignment list: assigning a conflict column
    # to itself is a no-op, and for a hidden tombstone it was the only assignment, so a
    # participation hidden a second time kept the timestamp of its first tombstone. The
    # conflict target already matched those columns, so the touch is what the write carries.
    assignments = [
        "%s = EXCLUDED.%s" % (_identifier(column), _identifier(column))
        for column in columns
        if column != KEY_COLUMN and column not in conflict_columns
    ]
    assignments.append("updated_at = CURRENT_TIMESTAMP")
    update = " DO UPDATE SET %s" % ", ".join(assignments)
    conflict = ", ".join(_identifier(column) for column in conflict_columns)
    return "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s)%s" % (
        TABLES[resource], ", ".join(_identifier(column) for column in columns),
        binds, conflict, update,
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


def snapshot_prune(resource: str, payloads: dict,
                   scope: "int | str | Iterable | None" = None) -> Optional[dict]:
    """The owner scope and key set a snapshot delete needs, or None for an incremental resource.

    WHY a full push prunes: it is the whole truth for the resource, so a key it omits was
    renamed or removed, and an upsert-only write would leave it behind. Scoping the delete by
    the owner field the payloads themselves carry reclaims those keys and leaves every other
    owner's rows untouched. A resource with no scope field is upsert-only, and an empty scope
    list has nothing safe to delete, so both answer None.

    scope: the owners the push knows even though its payloads carry no row to read one from.
    A push that emptied an owner still has to reclaim the rows it dropped, and with no keys
    left the delete is what does it. A push may know more than one: a task's owner field is
    its contest's name, so a contest renamed since the last push holds its rows under a scope
    the payloads no longer name, and the caller passes both so the delete reclaims both.

    """
    field = SNAPSHOT_SCOPE_FIELD.get(resource)
    if field is None:
        return None
    scopes = {payload[field] for payload in payloads.values() if field in payload}
    if scope is not None:
        scopes |= _owners(scope)
    if not scopes:
        return None
    return {"scopes": sorted(scopes), "keys": sorted(payloads)}


def _owners(scope) -> set:
    """The owners a caller named, as a set: one owner, or a collection of them."""
    if isinstance(scope, (list, tuple, set, frozenset)):
        return set(scope)
    return {scope}


def prune_statement(resource: str) -> str:
    """A delete of the snapshot rows a push no longer carries, for a resource that has a scope."""
    try:
        field = SNAPSHOT_SCOPE_FIELD[resource]
    except KeyError:
        raise ValueError("no snapshot scope for resource: %s" % resource) from None
    return "DELETE FROM %s WHERE %s = ANY(:scopes) AND %s <> ALL(:keys)" % (
        TABLES[resource], _identifier(field), KEY_COLUMN)


def _identifier(column: str) -> str:
    if column in RESERVED:
        return '"%s"' % column
    return column


def _bind(column: str) -> str:
    if column in JSON_COLUMNS:
        return "CAST(:%s AS jsonb)" % column
    return ":%s" % column

