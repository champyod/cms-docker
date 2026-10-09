#!/usr/bin/env python3
# tests/test_proxy_score_guard.py — a task with an unbuildable score type
# skips that task, not the whole initialization.
#
# WHY this suite exists: ProxyService.initialize() reads every task's
# score_type_object to learn its max score and extra headers, and that
# property can raise: get_score_type raises KeyError for an unknown type
# name, and the ScoreType constructor raises for malformed parameters. When
# that escaped, a single bad task took down the whole initialization, so
# rankings were told about no contest, no user and no task at all.
#
# It drives the REAL cms.service.ProxyService, so the code under test is
# untouched. Only the third-party import surface it needs is supplied:
# fatal_quit_surface already provides gevent, cms, cms.io and cmscommon, and
# this suite adds what ProxyService reaches for beyond those (sqlalchemy,
# requests, the cms.db entities) plus the cms.io re-exports the package
# initializer would normally provide. None of those are installed here, so
# without the surface nothing would import. It lives beside tests/ for the
# reason given in test_service_fatal_quit.py: the pytest suite imports the
# real gevent and needs cmscommon.crypto's conftest.
#
# Usage: python3 tests/test_proxy_score_guard.py

import queue
import sys
import types
import unittest
from datetime import datetime

from __lib.fatal_quit_surface import register

LOGGER_NAME = "cms.service.ProxyService"
RANKING_URL = "http://user:password@ranking.example/rws/"


class Contest:
    """Stand-in for cms.db.Contest, serving the contest the test registered.

    initialize() fetches the contest through the class, so the test registers
    the one it wants served before it builds the service.
    """

    current = None

    @classmethod
    def get_from_id(cls, contest_id, session):
        return cls.current


class Session:
    """Context manager standing in for a database session."""

    def __enter__(self):
        return self

    def __exit__(self, unused_type, unused_value, unused_traceback):
        return False


def SessionGen():
    """Return a session for initialize() to run its contest query in."""
    return Session()


def install_proxy_surface():
    """Supply the imports ProxyService needs beyond the shared surface."""
    gevent = sys.modules["gevent"]
    gevent.queue = register("gevent.queue", Queue=queue.Queue)

    requests = register("requests")
    requests.exceptions = register(
        "requests.exceptions", RequestException=Exception)

    # ProxyService imports not_, text and sqlalchemy.exc.SQLAlchemyError;
    # none runs in the initialize() path this suite drives, so placeholders
    # suffice for the import to succeed.
    sqlalchemy = register(
        "sqlalchemy", not_=lambda condition: condition,
        text=lambda statement: statement)
    sqlalchemy.exc = register("sqlalchemy.exc", SQLAlchemyError=Exception)

    database = sys.modules["cms.db"]
    database.SessionGen = SessionGen
    database.Contest = Contest
    database.Participation = object
    database.Task = object
    database.Submission = object
    database.get_submissions = lambda session, **kwargs: []

    sys.modules["cms"].config.proxy_service = types.SimpleNamespace(
        rankings=[RANKING_URL], https_certfile=None)

    io = sys.modules["cms.io"]
    from cms.io import priorityqueue, rpc, service
    io.PriorityQueue = priorityqueue.PriorityQueue
    io.QueueItem = priorityqueue.QueueItem
    io.QueueEntry = priorityqueue.QueueEntry
    io.Service = service.Service
    io.rpc_method = rpc.rpc_method
    # Only now: the module reads these back off the package it sits in.
    from cms.io.triggeredservice import Executor, TriggeredService
    io.Executor = Executor
    io.TriggeredService = TriggeredService


install_proxy_surface()

from cms.service.ProxyService import ProxyExecutor, ProxyService  # noqa: E402

TASK_TYPE = ProxyExecutor.TASK_TYPE
CONTEST_TYPE = ProxyExecutor.CONTEST_TYPE


class FakeScoreType:
    """The score type a dataset whose type name is known builds."""

    def __init__(self, max_score, ranking_headers):
        self.max_score = max_score
        self.ranking_headers = ranking_headers


class FakeDataset:
    """A dataset whose score_type_object builds or raises on demand.

    A real dataset raises out of the property when the type name is unknown
    or its parameters are malformed, so both outcomes are modelled here: pass
    the score type to build, or the exception to raise.
    """

    def __init__(self, outcome):
        self._outcome = outcome

    @property
    def score_type_object(self):
        if isinstance(self._outcome, BaseException):
            raise self._outcome
        return self._outcome


class FakeTask:
    """A task of the contest the test registered."""

    def __init__(self, name, dataset, num):
        self.name = name
        self.title = "The %s task" % name
        self.num = num
        self.active_dataset = dataset
        self.score_precision = 0
        self.score_mode = "max"


class FakeContest:
    """A contest holding the given tasks and no participations."""

    def __init__(self, tasks):
        self.name = "contest"
        self.description = "the contest"
        self.start = datetime(2026, 1, 1)
        self.stop = datetime(2026, 1, 2)
        self.score_precision = 0
        self.participations = []
        self.tasks = tasks


class ProbeProxyService(ProxyService):
    """A real ProxyService whose logging, which writes log files, is removed."""

    def initialize_logging(self):
        pass


class TestProxyScoreGuard(unittest.TestCase):
    """initialize() announces every task whose score type it can build."""

    def buildable_task(self, name, num):
        """Return a task whose score type builds cleanly."""
        return FakeTask(
            name, FakeDataset(FakeScoreType(100.0, ["task_%s" % name])), num)

    def broken_task(self, name, num, error):
        """Return a task whose score type cannot be built."""
        return FakeTask(name, FakeDataset(error), num)

    def initialize_with(self, tasks):
        """Run initialize() for a contest holding tasks, and return the service.

        The service constructor is what calls initialize(), so the loop under
        test is reached the way the running service reaches it.
        """
        Contest.current = FakeContest(tasks)
        return ProbeProxyService(shard=0, contest_id=1)

    def announced(self, service):
        """Return the data initialize() enqueued, keyed by entity type."""
        return {entry["item"]["type"]: entry["item"]["data"]
                for entry in service.get_executor().get_status()}

    def test_unknown_score_type_skips_only_that_task(self):
        with self.assertLogs(LOGGER_NAME, "WARNING") as caught:
            service = self.initialize_with([
                self.broken_task("nowhere", 0, KeyError("nonesuch")),
                self.buildable_task("sum", 1)])
        warning = "\n".join(caught.output)
        self.assertIn("nowhere", warning)
        self.assertIn("contest", warning)
        self.assertIn("KeyError", warning)
        announced = self.announced(service)
        self.assertEqual(list(announced[TASK_TYPE]), ["sum"])
        # The initialization went on to announce the contest as well.
        self.assertIn(CONTEST_TYPE, announced)

    def test_malformed_parameters_skip_only_that_task(self):
        with self.assertLogs(LOGGER_NAME, "WARNING") as caught:
            service = self.initialize_with([
                self.broken_task("stuck", 0, ValueError("not a number")),
                self.buildable_task("sum", 1)])
        warning = "\n".join(caught.output)
        self.assertIn("stuck", warning)
        self.assertIn("contest", warning)
        self.assertIn("ValueError", warning)
        announced = self.announced(service)
        self.assertEqual(list(announced[TASK_TYPE]), ["sum"])
        self.assertIn(CONTEST_TYPE, announced)

    def test_task_without_an_active_dataset_is_skipped(self):
        with self.assertLogs(LOGGER_NAME, "WARNING") as caught:
            service = self.initialize_with([
                FakeTask("undated", None, 0),
                self.buildable_task("sum", 1)])
        self.assertIn("undated", "\n".join(caught.output))
        self.assertEqual(list(self.announced(service)[TASK_TYPE]), ["sum"])

    def expected(self, name, num):
        """Return the payload a buildable task must be announced with."""
        return {
            "short_name": name,
            "name": "The %s task" % name,
            "contest": "contest",
            "order": num,
            "max_score": 100.0,
            "extra_headers": ["task_%s" % name],
            "score_precision": 0,
            "score_mode": "max",
        }

    def test_buildable_tasks_are_announced_unchanged(self):
        service = self.initialize_with([
            self.buildable_task("sum", 0),
            self.buildable_task("product", 1)])
        self.assertEqual(self.announced(service)[TASK_TYPE],
                         {"sum": self.expected("sum", 0),
                          "product": self.expected("product", 1)})


if __name__ == "__main__":
    unittest.main(verbosity=2)
