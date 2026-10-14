#!/usr/bin/env python3
# tests/test_service_contest_binding.py — a service's contest comes from its own registry row.
#
# WHY this suite exists: the resolver answered with the FIRST ContestWebServer row, so every
# contest server in a deployment served the same contest, and re-pointing a row reached nobody.
# These cases pin the replacement: the row for this (role, shard), the deployment default when
# no row names the instance, an explicit -c override, the per-instance cache that makes the read
# cheap enough to do per request, and the refusal of a service that cannot serve every contest.
#
# It drives the REAL cms.db.util with the third-party import surface supplied as placeholders —
# the same technique the sibling suites use — because sqlalchemy is not installed in this
# checkout.
#
# Usage: python3 tests/test_service_contest_binding.py

import importlib.util
import os
import sys
import time
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
        get_table_names=lambda: ["contests", "services"])
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


class FakeContest:
    def __init__(self, contest_id):
        self.id = contest_id


class FakeResult:
    """What session.execute() hands back."""

    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class FakeQuery:
    """The ORM chain active_contest_id() walks for the deployment default."""

    def __init__(self, row):
        self._row = row

    def filter(self, *criteria):
        return self

    def order_by(self, *columns):
        return self

    def first(self):
        return self._row


class FakeSession:
    """Answers the services row and the contests query, and records what was read.

    rows maps (role, shard) to the contest the row carries, or to None for a row that names
    no contest. A key the mapping does not hold stands for no row at all.
    """

    def __init__(self, rows, active_contest):
        self.rows = rows
        self.binding_reads = []
        self._contest_query = FakeQuery(
            None if active_contest is None else FakeContest(active_contest))

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        return False

    def execute(self, statement, params=None):
        self.binding_reads.append((params["role"], params["shard"]))
        key = (params["role"], params["shard"])
        if key not in self.rows:
            return FakeResult(None)
        return FakeResult((self.rows[key],))

    def query(self, model):
        return self._contest_query

    def get_bind(self):
        return object()


class TestServiceContestBinding(unittest.TestCase):
    def setUp(self):
        util.Contest = FakeContestModel
        # Both layers cache for a few seconds, so a case would read the previous one's answer
        # unless the caches are cleared between them.
        util._active_contest_cache = None
        util._service_binding_cache.clear()
        self.sessions = []

    def use_registry(self, rows, active_contest=None):
        """Point the resolver at a database holding `rows` and that active contest."""
        def session_gen():
            session = FakeSession(rows, active_contest)
            self.sessions.append(session)
            return session
        util.SessionGen = session_gen

    def test_the_row_for_this_instance_answers(self):
        self.use_registry({("ContestWebServer", 0): 8, ("ContestWebServer", 1): 3})
        self.assertEqual(util.service_binding("ContestWebServer", 0).contest_id, 8)
        self.assertEqual(util.service_binding("ContestWebServer", 1).contest_id, 3)

    def test_the_row_is_read_for_this_shard_not_the_first_row(self):
        self.use_registry({("ContestWebServer", 0): 8, ("ContestWebServer", 1): 3})
        util.service_binding("ContestWebServer", 1)
        self.assertEqual(self.sessions[0].binding_reads, [("ContestWebServer", 1)])

    def test_a_row_that_names_no_contest_means_every_contest(self):
        self.use_registry({("EvaluationService", 0): None}, active_contest=7)
        self.assertIsNone(util.contest_binding("EvaluationService", 0))

    def test_an_instance_no_row_names_serves_the_deployment_default(self):
        self.use_registry({}, active_contest=7)
        self.assertEqual(util.contest_binding("ContestWebServer", 3), 7)

    def test_an_override_wins_and_reads_no_row(self):
        self.use_registry({("ContestWebServer", 0): 8})
        self.assertEqual(util.contest_binding("ContestWebServer", 0, 3), 3)
        self.assertEqual(self.sessions, [])

    def test_the_answer_is_cached_per_instance(self):
        self.use_registry({("ContestWebServer", 0): 8, ("ContestWebServer", 1): 3})
        util.service_binding("ContestWebServer", 0)
        util.service_binding("ContestWebServer", 0)
        util.service_binding("ContestWebServer", 1)
        self.assertEqual(len(self.sessions), 2)

    def test_a_re_pointed_row_is_read_again_once_the_cache_expires(self):
        self.use_registry({("ContestWebServer", 0): 8})
        util.service_binding("ContestWebServer", 0)
        expired = time.monotonic() - util.REGISTRY_CONTEST_TTL_SECONDS - 1
        util._service_binding_cache[("ContestWebServer", 0)] = (
            expired, util.ServiceBinding(named=True, contest_id=3))
        self.assertEqual(util.service_binding("ContestWebServer", 0).contest_id, 8)
        self.assertEqual(len(self.sessions), 2)

    def test_an_instance_that_serves_one_contest_refuses_every_contest(self):
        self.use_registry({("ProxyService", 0): None}, active_contest=7)
        with self.assertRaises(ConfigError):
            util.contest_binding("ProxyService", 0, serves_one_contest=True)

    def test_nothing_naming_a_contest_is_fatal(self):
        self.use_registry({}, active_contest=None)
        with self.assertRaises(SystemExit):
            util.contest_binding("ContestWebServer", 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
