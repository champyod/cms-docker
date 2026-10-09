#!/usr/bin/env python3

"""Unit tests for the ranking projection mapping.

WHY the module is loaded by path instead of imported: importing cms builds the
configuration at import time and needs the full service dependency set, which a mapping
test must not require.
"""

import importlib.util
import json
import unittest
from pathlib import Path

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

    def test_rows_are_produced_in_a_stable_order(self):
        payloads = {
            "b": {"name": "B"},
            "a": {"name": "A"},
        }
        keys = [item["key"] for item in ranking_projection.rows("teams", payloads)]
        self.assertEqual(keys, ["a", "b"])


if __name__ == "__main__":
    unittest.main()

