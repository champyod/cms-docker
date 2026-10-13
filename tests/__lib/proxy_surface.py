#!/usr/bin/env python3
# tests/__lib/proxy_surface.py — the import surface and database stand-ins the
# ProxyService suites drive.
#
# WHY this exists: the suites exercise the REAL cms.service.ProxyService, but
# sqlalchemy, requests and the rest of the runtime are not installed in the
# checkout they run in. Everything ProxyService reaches for beyond the shared
# fatal_quit_surface is supplied here, so its own source loads untouched from the
# real tree while the suite runs on the standard library alone. One definition, so
# a second suite driving the same service cannot drift from the first.
#
# Imported by tests/test_proxy_score_guard.py and tests/test_proxy_projection_push.py.

import sys
import types

from __lib.fatal_quit_surface import register


class Contest:
    """Stand-in for cms.db.Contest, serving the contest a test registered.

    initialize() fetches the contest through the class, so a test registers the
    one it wants served before it builds the service.
    """

    current = None

    @classmethod
    def get_from_id(cls, contest_id, session):
        return cls.current


class Session:
    """A database session that records what it was asked to do.

    initialize() only needs the context manager; the projection suites read back
    the statements a push executed and whether it committed, so that record lives
    here rather than in each suite.
    """

    instances = []
    failure = None

    def __init__(self):
        self.executed = []
        self.commit_count = 0
        self.rollback_count = 0
        Session.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, unused_type, unused_value, unused_traceback):
        return False

    def execute(self, statement, parameters):
        if Session.failure is not None:
            raise Session.failure
        self.executed.append((statement, parameters))

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1


def SessionGen():
    """Return a session for the code under test to run its queries in."""
    return Session()


def install_proxy_surface(ranking_url):
    """Supply the imports ProxyService needs beyond the shared surface."""
    gevent = sys.modules["gevent"]
    import queue

    gevent.queue = register("gevent.queue", Queue=queue.Queue)

    requests = register("requests")
    requests.exceptions = register(
        "requests.exceptions", RequestException=Exception)

    # ProxyService imports not_, text and sqlalchemy.exc.SQLAlchemyError;
    # none runs in the paths these suites drive, so placeholders suffice for the
    # import to succeed.
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
        rankings=[ranking_url], https_certfile=None)

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

    # ProxyService resolves display usernames through cms.db.username, a package in
    # the real tree, but the cms.db the shared surface registers is a plain module —
    # so the submodule is registered here or the import fails as "cms.db is not a
    # package". Neither function runs in the paths these suites drive.
    register("cms.db.username",
             get_display_usernames=lambda *_args, **_kwargs: {},
             resolve_username_config=lambda *_args, **_kwargs: {})