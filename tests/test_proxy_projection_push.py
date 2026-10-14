#!/usr/bin/env python3
# tests/test_proxy_projection_push.py — the ranking projection is written as one
# transaction, so a reader never sees a push that landed in some tables and not
# others.
#
# Usage: python3 tests/test_proxy_projection_push.py

import unittest
from datetime import datetime

from __lib.proxy_surface import Contest, Session, SessionGen, \
    install_proxy_surface

RANKING_URL = "http://user:password@ranking.example/rws/"

install_proxy_surface(RANKING_URL)

import cms.service.ProxyService as proxy_service  # noqa: E402
from cms.service.ProxyService import CannotSendError, ProxyExecutor, \
    ProxyService  # noqa: E402

CONTEST_PAYLOADS = {
    "c1": {"name": "contest", "begin": 0, "end": 1, "score_precision": 0}}
TEAM_PAYLOADS = {"t1": {"name": "Team"}}
UNKNOWN_RESOURCE = "nonesuch"


class FakeContest:
    """A contest holding no tasks and no participations."""

    def __init__(self):
        self.name = "contest"
        self.description = "the contest"
        self.start = datetime(2026, 1, 1)
        self.stop = datetime(2026, 1, 2)
        self.score_precision = 0
        self.participations = []
        self.tasks = []
        # initialize() walks the contest's ContestTask rows; this contest holds none.
        self.task_contests = []


class Item:
    """The queue item shape the executor reads."""

    def __init__(self, type_, data):
        self.type_ = type_
        self.data = data


class Entry:
    """The queue entry shape the executor reads."""

    def __init__(self, item):
        self.item = item


class ProbeProxyService(ProxyService):
    """A real ProxyService whose logging, which writes log files, is removed."""

    def initialize_logging(self):
        pass


class ProjectionPushTest(unittest.TestCase):
    """One transaction, however many tables the push carries."""

    def setUp(self):
        Session.instances.clear()
        Session.failure = None

    def test_every_table_is_written_in_one_session_and_one_commit(self):
        proxy_service.write_projection(
            [("contests", CONTEST_PAYLOADS), ("teams", TEAM_PAYLOADS)], "sending")

        self.assertEqual(len(Session.instances), 1)
        session = Session.instances[0]
        self.assertEqual(session.commit_count, 1)
        self.assertEqual(len(session.executed), 2)

    def test_a_refused_table_refuses_the_whole_push(self):
        # The first table's rows are already bound when the second is refused, so
        # committing per table would have published them.
        with self.assertRaises(CannotSendError):
            proxy_service.write_projection(
                [("contests", CONTEST_PAYLOADS),
                 (UNKNOWN_RESOURCE, TEAM_PAYLOADS)], "sending")

        self.assertEqual([session.commit_count for session in Session.instances],
                         [0])

    def test_a_database_failure_refuses_the_push_and_commits_nothing(self):
        Session.failure = RuntimeError("connection lost")

        with self.assertRaises(CannotSendError):
            proxy_service.write_projection(
                [("contests", CONTEST_PAYLOADS), ("teams", TEAM_PAYLOADS)],
                "sending")

        self.assertEqual([session.commit_count for session in Session.instances],
                         [0])

    def test_a_retried_push_repeats_the_same_rows(self):
        # A retry after a failure has to be able to re-send the whole push, so the
        # statement a push binds must not depend on anything but its payload.
        proxy_service.write_projection([("teams", TEAM_PAYLOADS)], "sending")
        first = Session.instances[0].executed[0]

        proxy_service.write_projection([("teams", TEAM_PAYLOADS)], "sending")
        second = Session.instances[1].executed[0]

        self.assertEqual(first, second)


class ExecutorPushTest(unittest.TestCase):
    """The executor hands every table of one queue batch to a single push."""

    def build_executor(self):
        Contest.current = FakeContest()
        service = ProbeProxyService(shard=0, contest_id=1)
        return service.get_executor()

    def test_a_two_table_batch_becomes_one_push(self):
        executor = self.build_executor()
        Session.instances.clear()

        executor.execute([
            Entry(Item(ProxyExecutor.CONTEST_TYPE, CONTEST_PAYLOADS)),
            Entry(Item(ProxyExecutor.TEAM_TYPE, TEAM_PAYLOADS))])

        self.assertEqual(len(Session.instances), 1)
        self.assertEqual(Session.instances[0].commit_count, 1)
        self.assertEqual(len(Session.instances[0].executed), 2)

    def test_an_empty_batch_opens_no_session(self):
        executor = self.build_executor()
        Session.instances.clear()

        executor.execute([])

        self.assertEqual(Session.instances, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)