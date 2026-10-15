#!/usr/bin/env python3

"""Unit tests for the ranking projection mapping.

WHY the module is loaded by path instead of imported: importing cms builds the
configuration at import time and needs the full service dependency set, which a mapping
test must not require.
"""

import importlib.util
import json
import re
import unittest
from pathlib import Path

# A bind placeholder and a quoted identifier are the only two places a reserved word may
# appear; anything left over would be a bare reserved identifier in the SQL.
PLACEHOLDER_OR_QUOTED = re.compile(r'(?::\w+)|(?:"[^"]*")')

# Matched over what the strip leaves behind. Whole-token matching is required: the table
# name `ranking_users` contains the reserved word `user` and must not read as one.
BARE_IDENTIFIER = re.compile(r"[A-Za-z_]\w*")

# WHY this list is independent of the module's own RESERVED: RESERVED is what decides
# which identifiers get quoted, so asserting against it would only prove the module
# agrees with itself. The words below are Postgres' reserved words, taken from Appendix C
# of its documentation, lowercased because an unquoted SQL keyword is case-insensitive
# and the column names are lowercase. A column that is reserved here but missing from
# RESERVED is the exact defect that made the push fail, so this list is the oracle that
# catches it. An empty intersection here means the comparison has silently stopped
# matching, so the tests below also assert it is non-empty.
POSTGRES_RESERVED = frozenset("""
ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC BOTH CASE CAST CHECK COLLATE
COLUMN CONSTRAINT CREATE CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_TIME
CURRENT_TIMESTAMP CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT
FALSE FETCH FOR FOREIGN FROM GRANT GROUP HAVING IN INITIALLY INTERSECT INTO LATERAL
LEADING LIMIT LOCALTIME LOCALTIMESTAMP NOT NULL OFFSET ON ONLY OR ORDER PLACING
PRIMARY REFERENCES RETURNING SELECT SESSION_USER SOME SYMMETRIC TABLE THEN TO
TRAILING TRUE UNION UNIQUE USER USING VARIADIC WHEN WHERE WINDOW WITH
""".lower().split())

MODULE_PATH = Path(__file__).resolve().parents[3] / "cms" / "service" / "ranking_projection.py"
SPEC = importlib.util.spec_from_file_location("ranking_projection", MODULE_PATH)
ranking_projection = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ranking_projection)


class ProjectionTest(unittest.TestCase):

    def test_every_resource_names_a_table_and_a_column_list(self):
        self.assertEqual(sorted(ranking_projection.TABLES), sorted(ranking_projection.COLUMNS))
        self.assertEqual(sorted(ranking_projection.TABLES), sorted(ranking_projection.REQUIRED))
        for columns in ranking_projection.COLUMNS.values():
            self.assertEqual(columns[0], "key")

    def test_the_task_order_field_lands_in_display_order(self):
        payload = {
            "name": "Task",
            "short_name": "T0",
            "contest": "c0",
            "max_score": 100.0,
            "score_precision": 2,
            "extra_headers": ["School"],
            "order": 7,
            "score_mode": "max",
        }
        row = ranking_projection.row("tasks", "t0", payload)
        self.assertEqual(row["display_order"], 7)
        self.assertNotIn("order", row)
        self.assertEqual(row["key"], "t0")

    def test_json_columns_are_serialised_for_the_cast(self):
        row = ranking_projection.row("tasks", "t0", {
            "name": "Task", "short_name": "T0", "contest": "c0", "max_score": 1.0,
            "score_precision": 0, "extra_headers": ["A", "B"], "order": 0,
            "score_mode": "max",
        })
        self.assertEqual(json.loads(row["extra_headers"]), ["A", "B"])

    def test_an_optional_field_absent_from_the_payload_is_null(self):
        row = ranking_projection.row("subchanges", "sc0", {
            "submission": "s0", "time": 1700000000,
        })
        self.assertIsNone(row["score"])
        self.assertIsNone(row["token"])
        self.assertIsNone(row["extra"])

    def test_a_payload_missing_a_required_field_is_refused(self):
        with self.assertRaises(ValueError) as raised:
            ranking_projection.row("users", "u0", {"f_name": "Ada"})
        self.assertIn("l_name", str(raised.exception))

    def test_an_unknown_resource_is_refused(self):
        with self.assertRaises(ValueError):
            ranking_projection.row("flags", "f0", {})

    def test_the_upsert_casts_json_and_updates_on_conflict(self):
        statement = ranking_projection.upsert_statement("tasks")
        self.assertIn("CAST(:extra_headers AS jsonb)", statement)
        self.assertIn("ON CONFLICT (key) DO UPDATE SET", statement)
        for column in ranking_projection.COLUMNS["tasks"]:
            self.assertIn(":%s" % column, statement)

    def test_the_contest_statement_quotes_the_reserved_identifiers(self):
        statement = ranking_projection.upsert_statement("contests")
        self.assertIn('(key, name, "begin", "end", score_precision)', statement)
        self.assertIn('"begin" = EXCLUDED."begin"', statement)
        self.assertIn('"end" = EXCLUDED."end"', statement)
        self.assertIn(":begin", statement)
        self.assertIn(":end", statement)

    def test_the_reserved_word_oracle_matches_the_columns(self):
        matched = {
            resource: sorted(set(columns) & POSTGRES_RESERVED)
            for resource, columns in ranking_projection.COLUMNS.items()
        }
        # WHY `begin` is absent: Postgres lists it as non-reserved, so the oracle does not
        # require it quoted. The module quotes it anyway for SQL-standard safety.
        self.assertEqual(
            sorted(c for cols in matched.values() for c in cols), ["end", "user"],
            "the reserved-word oracle no longer matches any column: %r" % matched,
        )

    def test_module_reserved_covers_every_reserved_column(self):
        for resource, columns in ranking_projection.COLUMNS.items():
            expected = set(columns) & POSTGRES_RESERVED
            with self.subTest(resource=resource):
                self.assertEqual(
                    expected & ranking_projection.RESERVED, expected,
                    "%s declares a Postgres reserved column that RESERVED omits" % resource,
                )

    def test_no_reserved_column_survives_unquoted(self):
        for resource, columns in ranking_projection.COLUMNS.items():
            statement = ranking_projection.upsert_statement(resource)
            bare = set(BARE_IDENTIFIER.findall(PLACEHOLDER_OR_QUOTED.sub("", statement)))
            for column in set(columns) & POSTGRES_RESERVED:
                with self.subTest(resource=resource, column=column):
                    self.assertNotIn(column, bare)

    def test_rows_are_produced_in_a_stable_order(self):
        payloads = {
            "b": {"name": "B"},
            "a": {"name": "A"},
        }
        keys = [item["key"] for item in ranking_projection.rows("teams", payloads)]
        self.assertEqual(keys, ["a", "b"])

    def test_a_full_task_push_prunes_only_its_own_contest(self):
        statement = ranking_projection.prune_statement("tasks")
        self.assertIn("DELETE FROM ranking_tasks", statement)
        self.assertIn("contest = ANY(:scopes)", statement)
        self.assertIn("key <> ALL(:keys)", statement)

    def test_an_incremental_resource_is_never_pruned(self):
        self.assertIsNone(ranking_projection.snapshot_prune("submissions", {"1": {}}))
        with self.assertRaises(ValueError):
            ranking_projection.prune_statement("submissions")

    def test_the_prune_scope_comes_from_the_payloads(self):
        payloads = {"t0": {"contest": "c0"}, "t1": {"contest": "c0"}}
        self.assertEqual(
            ranking_projection.snapshot_prune("tasks", payloads),
            {"scopes": ["c0"], "keys": ["t0", "t1"]},
        )

    def test_a_hidden_row_names_a_key_and_the_contest_it_is_hidden_in(self):
        row = ranking_projection.row("hidden", "u0", {"contest_id": 7})
        self.assertEqual(row, {"key": "u0", "contest_id": 7})
        with self.assertRaises(ValueError) as raised:
            ranking_projection.row("hidden", "u0", {})
        self.assertIn("contest_id", str(raised.exception))

    def test_the_hidden_upsert_conflicts_on_the_key_and_the_contest(self):
        statement = ranking_projection.upsert_statement("hidden")
        self.assertIn(
            "INSERT INTO ranking_hidden (key, contest_id)", statement)
        self.assertIn("ON CONFLICT (key, contest_id) DO UPDATE SET", statement)

    def test_no_upsert_assigns_a_conflict_column_and_all_refresh_updated_at(self):
        # WHY: a conflict column assigned to itself is a no-op, and for a hidden tombstone
        # it was the whole SET list, so a participation hidden a second time kept the
        # timestamp of its first tombstone while the panel mirror refreshed its own.
        for resource in ranking_projection.COLUMNS:
            statement = ranking_projection.upsert_statement(resource)
            conflict_columns = ranking_projection.CONFLICT_COLUMNS.get(
                resource, (ranking_projection.KEY_COLUMN,))
            with self.subTest(resource=resource):
                self.assertIn("updated_at = CURRENT_TIMESTAMP", statement)
                for column in conflict_columns:
                    self.assertNotIn(
                        "%s = EXCLUDED.%s" % (column, column), statement,
                        "an assignment of a conflict column to itself is a no-op")

    def test_a_hidden_push_prunes_only_its_own_contest(self):
        statement = ranking_projection.prune_statement("hidden")
        self.assertIn("DELETE FROM ranking_hidden", statement)
        self.assertIn("contest_id = ANY(:scopes)", statement)
        self.assertIn("key <> ALL(:keys)", statement)
        self.assertEqual(
            ranking_projection.snapshot_prune(
                "hidden", {"u0": {"contest_id": 7}, "u1": {"contest_id": 7}}),
            {"scopes": [7], "keys": ["u0", "u1"]},
        )

    def test_an_empty_push_prunes_the_tombstone_of_the_owner_it_names(self):
        # The push that unhid the last participation has no row left to read the
        # contest from, so the owner travels beside the payloads: with no keys, the
        # delete is what reclaims the tombstone of the participation just unhidden.
        self.assertEqual(
            ranking_projection.snapshot_prune("hidden", {}, scope=7),
            {"scopes": [7], "keys": []},
        )
        self.assertEqual(
            ranking_projection.snapshot_prune("tasks", {}, scope="c0"),
            {"scopes": ["c0"], "keys": []},
        )

    def test_an_empty_push_without_an_owner_still_prunes_nothing(self):
        self.assertIsNone(ranking_projection.snapshot_prune("hidden", {}))
        self.assertIsNone(ranking_projection.snapshot_prune("submissions", {}, scope=7))


if __name__ == "__main__":
    unittest.main()

