#!/usr/bin/env python3
# tests/test_proxy_task_reconcile.py — a contest's task set that changed without an admin
# edit announcing it is found by the proxy's own sweep and announced again.
#
# WHY this suite exists: the full task push is the only thing that tells a ranking which
# tasks a contest has, and until now only an admin handler made it. A task attached to the
# contest by an import, the panel or a script left the ranking holding the previous set —
# and because tasks are a snapshot scoped to the contest, an edit that emptied the set had
# already pruned the rows the board draws from. The board then drew another contest's
# columns, or none, with nothing in the log. The proxy already sweeps for work it missed;
# the sweep is where a missed task announcement is found.
#
# It drives the REAL cms.service.ProxyService, so the code under test is untouched. Only
# the import surface it needs is supplied, by the shared proxy_surface: none of sqlalchemy,
# requests or the cms runtime is installed in the checkout this runs in.
#
# Usage: python3 tests/test_proxy_task_reconcile.py

import unittest
from datetime import datetime
from types import SimpleNamespace

from __lib.proxy_surface import Contest, Session, install_proxy_surface

RANKING_URL = "http://user:password@ranking.example/rws/"

install_proxy_surface(RANKING_URL)

import cms.service.ProxyService as proxy_service  # noqa: E402
from cms.service.ProxyService import ProxyExecutor  # noqa: E402

TASK_TYPE = ProxyExecutor.TASK_TYPE


class FakeScoreType:
    """The score type a task's active dataset builds."""

    def __init__(self, max_score):
        self.max_score = max_score
        self.ranking_headers = []


class FakeDataset:
    """A dataset whose score type builds cleanly."""

    def __init__(self):
        self.score_type_object = FakeScoreType(100.0)


class FakeTask:
    """A task of the contest, with the fields a task payload is built from."""

    def __init__(self, name, num):
        self.name = name
        self.title = "The %s task" % name
        self.num = num
        self.active_dataset = FakeDataset()
        self.score_precision = 0
        self.score_mode = "max"


class FakeContest:
    """A contest whose membership changes the way an edit outside the handlers does.

    attach() and rename() change the contest in the database, without going through the
    admin handler that would have announced it.
    """

    def __init__(self, name="contest"):
        self.name = name
        self.description = "the contest"
        self.start = datetime(2026, 1, 1)
        self.stop = datetime(2026, 1, 2)
        self.score_precision = 0
        self.participations = []
        self.tasks = []
        self.task_contests = []

    def attach(self, name):
        """Add a task to the contest, as an import or the panel does."""
        task = FakeTask(name, len(self.tasks))
        self.tasks.append(task)
        self.task_contests = [SimpleNamespace(task=member, num=member.num)
                              for member in self.tasks]

    def rename(self, name):
        """Rename the contest, as an edit outside the handlers does."""
        self.name = name


class EmptySubmissions:
    """The submission query _missing_operations filters: this contest holds none."""

    def filter(self, *unused):
        return self

    def all(self):
        return []


class RecordingProxyService(proxy_service.ProxyService):
    """A real ProxyService that records the operations it enqueues.

    The queue's status serializes an operation without its scope, so the operations are
    kept here instead: the scope is what a rename has to carry.
    """

    def __init__(self, *args, **kwargs):
        self.enqueued = []
        super().__init__(*args, **kwargs)

    def initialize_logging(self):
        pass

    def enqueue(self, operation, priority=None, timestamp=None):
        self.enqueued.append(operation)
        return super().enqueue(operation, priority, timestamp)

    def task_operations(self):
        """The task announcements this service queued, in order."""
        return [operation for operation in self.enqueued
                if operation.type_ == TASK_TYPE]


class TaskReconcileTest(unittest.TestCase):
    """The sweep announces the task set the database holds, not the one it announced."""

    def build(self, *task_names):
        """Start the service on a registered contest holding the given tasks."""
        Contest.current = FakeContest()
        for name in task_names:
            Contest.current.attach(name)
        # _missing_operations also filters the submission query, and the surface's entities
        # are stand-ins with no such attributes, so they are given the ones it reads.
        proxy_service.Participation = SimpleNamespace(hidden=None)
        proxy_service.Submission = SimpleNamespace(official=None)
        proxy_service.get_submissions = \
            lambda session, **unused: EmptySubmissions()
        return RecordingProxyService(shard=0, contest_id=1)

    def test_the_sweep_announces_a_task_attached_since_the_last_announcement(self):
        service = self.build("first")
        service.enqueued.clear()

        # The contest gains a task with nothing announcing it, which is the day the board
        # kept drawing the previous set.
        Contest.current.attach("second")
        found = service._missing_operations()

        self.assertEqual(found, 1, "the missed announcement is one operation")
        announced = service.task_operations()
        self.assertEqual(len(announced), 1, "exactly one announcement was queued")
        self.assertEqual(sorted(announced[0].data), ["first", "second"])

    def test_the_sweep_is_quiet_when_the_task_set_did_not_change(self):
        service = self.build("first", "second")
        service.enqueued.clear()

        self.assertEqual(service._missing_operations(), 0)
        self.assertEqual(service.task_operations(), [],
                         "an unchanged set is not announced again")

    def test_a_task_added_with_no_active_dataset_is_still_announced_again(self):
        # The production shape: the set empties because every task of the contest is
        # unscoreable, and a task that becomes scoreable later has to reach the board.
        service = self.build()
        service.enqueued.clear()

        Contest.current.attach("late")
        self.assertEqual(service._missing_operations(), 1)

        service.enqueued.clear()
        Contest.current.tasks[0].active_dataset = None
        self.assertEqual(service._missing_operations(), 1,
                         "a task that stopped being scoreable is a change too")
        self.assertEqual(service.task_operations()[0].data, {})

    def test_a_renamed_contest_prunes_the_rows_left_under_the_old_name(self):
        service = self.build("first")
        service.enqueued.clear()

        Contest.current.rename("renamed")
        self.assertEqual(service._missing_operations(), 1)

        announced = service.task_operations()[0]
        self.assertEqual(announced.scope, {"contest", "renamed"},
                         "the old name's rows are reclaimed with the new one's")
        self.assertEqual(sorted(announced.data), ["first"])

    def test_the_rename_reaches_the_prune_end_to_end(self):
        # The scope a rename carries is only worth carrying if the delete it drives names
        # both owners, so the queued announcement is run through the real executor.
        service = self.build("first")
        Contest.current.rename("renamed")
        service._missing_operations()
        Session.instances.clear()

        service.get_executor().execute(
            [SimpleNamespace(item=service.task_operations()[-1])])

        executed = Session.instances[0].executed
        prunes = [parameters for statement, parameters in executed
                  if statement.startswith("DELETE")]
        self.assertEqual(prunes, [{"scopes": ["contest", "renamed"],
                                   "keys": ["first"]}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
