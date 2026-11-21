#!/usr/bin/env python3
# tests/test_active_contest_read.py — the active-contest lookup must be deterministic.
#
# WHY this suite exists: active_contest_id() is the database read every contest-facing service
# uses to decide which contest to serve. Without an ORDER BY, a database holding two is_active
# rows can hand a service a different contest than the panel and the config sync pick, so the
# lookup has to order by id the way they do.
#
# It drives the REAL cms.db.util with the third-party import surface supplied as placeholders —
# the same technique the sibling suites use — because sqlalchemy is not installed in this checkout.
#
# Usage: python3 tests/test_active_contest_read.py

import importlib.util
import os
import sys
import types
import unittest

LIB_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(LIB_DIR)
SRC_ROOT = os.path.join(REPO_ROOT, "src")
sys.path.insert(0, SRC_ROOT)


class ConfigError(Exception):
    """Mirror of cms.ConfigError, which util.py imports at module load."""


def install_surface():
    """Supply every non-stdlib import cms.db.util performs, so its real source loads."""
    cms = types.ModuleType("cms")
    cms.__path__ = [os.path.join(SRC_ROOT, "cms")]
    cms.ConfigError = ConfigError
    sys.modules["cms"] = cms

    sqlalchemy = types.ModuleType("sqlalchemy")
    sqlalchemy.union = lambda *queries: queries
    sqlalchemy.inspect = lambda bind: types.SimpleNamespace(
        get_table_names=lambda: ["contests"])
    sqlalchemy.text = lambda statement: statement
    sqlalchemy.exc = types.ModuleType("sqlalchemy.exc")
    sqlalchemy.exc.OperationalError = type("OperationalError", (Exception,), {})
    sqlalchemy.orm = types.ModuleType("sqlalchemy.orm")
    sqlalchemy.orm.Query = object
    sys.modules["sqlalchemy"] = sqlalchemy
    sys.modules["sqlalchemy.exc"] = sqlalchemy.exc
    sys.modules["sqlalchemy.orm"] = sqlalchemy.orm

    database = types.ModuleType("cms.db")
    database.__path__ = [os.path.join(SRC_ROOT, "cms", "db")]
    for name in (
        "SessionGen", "Digest", "Contest", "ContestTask", "Participation", "Statement",
        "Attachment", "Task", "Manager", "Dataset", "Testcase", "Submission",
        "File", "SubmissionResult", "Executable", "UserTest", "UserTestFile",
        "UserTestManager", "UserTestResult", "UserTestExecutable", "Session",
    ):
        setattr(database, name, object)
    sys.modules["cms.db"] = database


install_surface()

# cms.db is a placeholder, so load the real util.py by path rather than through the package.
_SPEC = importlib.util.spec_from_file_location(
    "cms.db.util", os.path.join(SRC_ROOT, "cms", "db", "util.py"))
util = importlib.util.module_from_spec(_SPEC)
sys.modules["cms.db.util"] = util
_SPEC.loader.exec_module(util)


class FakeContestModel:
    """Stand-in for cms.db.Contest, exposing the columns the query touches."""

    class is_active:
        @staticmethod
        def is_(value):
            return value

    id = "contests.id"


class FakeQuery:
    """Records the order_by it was handed, so the test can assert it happened."""

    def __init__(self, row):
        self._row = row
        self.ordered_by = None

    def filter(self, *criteria):
        return self

    def order_by(self, *columns):
        self.ordered_by = columns
        return self

    def first(self):
        return self._row


class FakeSession:
    """A context-managed session whose query chain is the fake above."""

    def __init__(self, row):
        self.query_obj = FakeQuery(row)

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        return False

    def query(self, model):
        return self.query_obj

    def get_bind(self):
        return object()


class FakeContest:
    def __init__(self, contest_id):
        self.id = contest_id


class TestActiveContestRead(unittest.TestCase):
    def setUp(self):
        util.Contest = FakeContestModel
        # The resolver caches its answer for a few seconds, so a later test would read
        # the previous one's result unless the cache is cleared between cases.
        util._active_contest_cache = None

    def read_with(self, session):
        util.SessionGen = lambda: session
        return util.active_contest_id()

    def test_orders_by_id_before_first(self):
        session = FakeSession(FakeContest(3))
        self.assertEqual(self.read_with(session), 3)
        self.assertEqual(session.query_obj.ordered_by, (FakeContestModel.id,))

    def test_returns_none_when_no_row_is_active(self):
        self.assertIsNone(self.read_with(FakeSession(None)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
