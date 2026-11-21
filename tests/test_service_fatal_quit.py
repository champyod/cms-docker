#!/usr/bin/env python3
# tests/test_service_fatal_quit.py — guard the fatal-quit exit-status contract.
#
# WHY this suite exists: WorkerPool.check_timeouts asked a hung worker to shut
# down through Service.quit, which ended run() as a clean exit, so the worker
# process exited 0 and the on-failure restart policy never brought it back.
# Every service script maps run() to the process status
# ("return 0 if success is True else 1"), so one flag decides whether a dead
# worker gets replaced or is silently lost.
#
# It drives the REAL cms.io.service.Service and the REAL
# cms.service.workerpool.WorkerPool; only the third-party import surface those
# two modules pull in is supplied, by tests/__lib/fatal_quit_surface.py,
# because gevent, sqlalchemy and the rest of the runtime dependencies are not
# installed in this checkout. The code under test is untouched. No network, no
# docker, no database, no sleeps.
#
# It lives beside tests/ rather than in src/cmstestsuite/unit_tests/ because
# every file in that suite imports the real gevent and is collected by a
# conftest that imports cmscommon.crypto, so nothing there runs on the standard
# library alone — and replacing sys.modules["gevent"] process-wide would break
# sibling tests that need the genuine module.
#
# Usage: python3 tests/test_service_fatal_quit.py

import inspect
import logging
import os
import unittest
from datetime import timedelta

from __lib.fatal_quit_surface import CLOCK, REACHABILITY_HINT, Service, WorkerPool

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# Both shutdown paths log a warning on their way out; every case below drives
# them, so a passing run would otherwise be buried in expected noise.
for LOGGED_MODULE in ("cms.io.service", "cms.service.workerpool"):
    logging.getLogger(LOGGED_MODULE).setLevel(logging.CRITICAL)


class ProbeService(Service):
    """A real Service whose logging, which writes log files, is removed."""

    def initialize_logging(self):
        pass


class RecordingRemote:
    """Stand-in for a RemoteServiceClient that records the RPC keyword args."""

    connected = True

    def __init__(self):
        self.quit_calls = []

    def quit(self, **kwargs):
        self.quit_calls.append(kwargs)


def timed_out_reason(active_for):
    """Return the reason WorkerPool.check_timeouts reports to a lost worker."""
    return "No response in %s - %s." % (active_for, REACHABILITY_HINT)


class TestServiceExitStatus(unittest.TestCase):
    """run() reports failure only when the service was asked to quit fatally."""

    def run_shut_down_by(self, quit_action):
        """Return run()'s value for a service quit_action shuts down."""
        service = ProbeService(shard=0)
        service.rpc_server.on_serve = lambda: quit_action(service)
        return service.run()

    def test_the_rpc_surface_still_carries_the_flag(self):
        # WorkerPool reaches the worker through the RPC server, so a quit that
        # is not rpc_callable, or that drops the flag, never reaches it.
        self.assertTrue(Service.quit.rpc_callable)
        self.assertIn("fatal",
                      inspect.signature(Service.exit).parameters)
        self.assertIn("fatal",
                      inspect.signature(Service.quit).parameters)

    def test_clean_exit_reports_success(self):
        self.assertTrue(self.run_shut_down_by(lambda service: service.exit()))

    def test_clean_quit_reports_success(self):
        self.assertTrue(self.run_shut_down_by(
            lambda service: service.quit(reason="asked by ResourceService")))

    def test_bare_quit_reports_success(self):
        self.assertTrue(self.run_shut_down_by(lambda service: service.quit()))

    def test_fatal_quit_reports_failure(self):
        self.assertFalse(self.run_shut_down_by(
            lambda service: service.quit(reason="No response", fatal=True)))

    def test_fatal_exit_reports_failure(self):
        self.assertFalse(
            self.run_shut_down_by(lambda service: service.exit(fatal=True)))

    def test_fatal_quit_survives_a_later_clean_exit(self):
        # A signal can land between the fatal quit and the main loop returning;
        # the flag is monotonic, so the later clean exit cannot clear it.
        def quit_then_signal(service):
            service.quit(reason="timed out", fatal=True)
            service.exit()

        self.assertFalse(self.run_shut_down_by(quit_then_signal))

    def test_fatal_quit_survives_a_later_clean_quit(self):
        def quit_then_quit(service):
            service.quit(reason="timed out", fatal=True)
            service.quit(reason="confirmed")

        self.assertFalse(self.run_shut_down_by(quit_then_quit))


class TestWorkerPoolFatalQuit(unittest.TestCase):
    """check_timeouts quits a timed-out worker fatally, and only that worker."""

    TIMED_OUT = WorkerPool.WORKER_TIMEOUT + timedelta(seconds=1)

    def add_shard(self, pool, shard, start_time, operations):
        """Give pool a worker on shard that started at start_time."""
        remote = RecordingRemote()
        pool._worker[shard] = remote
        pool._operations[shard] = list(operations)
        pool._operations_to_ignore[shard] = []
        pool._start_time[shard] = start_time
        pool._schedule_disabling[shard] = False
        pool._ignore[shard] = False
        for operation in operations:
            pool._operations_reverse[operation] = shard
        return remote

    def build_pool(self):
        """Return a pool whose shard 0 and 1 timed out and whose shard 2 is fine."""
        pool = WorkerPool(service=None)
        silence = self.TIMED_OUT.total_seconds()
        self.timed_out = [
            self.add_shard(pool, 0, CLOCK.before(silence),
                           ["lost-on-0", "lost-on-0-again"]),
            self.add_shard(pool, 1, CLOCK.before(silence), ["lost-on-1"]),
        ]
        self.healthy = self.add_shard(pool, 2, CLOCK.now, ["running-on-2"])
        return pool

    def test_timed_out_shards_are_quit_fatally_once_each(self):
        pool = self.build_pool()
        pool.check_timeouts()
        # A second pass must not re-quit: the release cleared the start time.
        pool.check_timeouts()
        for remote in self.timed_out:
            self.assertEqual(len(remote.quit_calls), 1)
            self.assertIs(remote.quit_calls[0]["fatal"], True)

    def test_timed_out_quit_keeps_the_reason(self):
        pool = self.build_pool()
        pool.check_timeouts()
        for remote in self.timed_out:
            self.assertEqual(remote.quit_calls[0]["reason"],
                             timed_out_reason(self.TIMED_OUT))

    def test_lost_operations_are_returned(self):
        pool = self.build_pool()
        self.assertEqual(pool.check_timeouts(),
                         ["lost-on-0", "lost-on-0-again", "lost-on-1"])

    def test_timed_out_shards_end_disabled(self):
        pool = self.build_pool()
        pool.check_timeouts()
        for shard in (0, 1):
            self.assertIs(pool._operations[shard], WorkerPool.WORKER_DISABLED)

    def test_healthy_shard_is_left_alone(self):
        pool = self.build_pool()
        pool.check_timeouts()
        self.assertEqual(self.healthy.quit_calls, [])
        self.assertEqual(pool._operations[2], ["running-on-2"])
        # Still mid-operation: the pool never released it.
        self.assertIs(pool._start_time[2], CLOCK.now)

    def test_the_quit_the_pool_sends_makes_the_worker_report_failure(self):
        # Closes the loop: the kwargs check_timeouts puts on the wire are the
        # ones the worker's run() answers, so the process status the on-failure
        # restart policy watches is nonzero.
        pool = self.build_pool()
        pool.check_timeouts()
        on_the_wire = self.timed_out[0].quit_calls[0]
        worker = ProbeService(shard=0)
        worker.rpc_server.on_serve = lambda: worker.quit(**on_the_wire)
        self.assertFalse(worker.run())


class TestWorkerScriptExitMapping(unittest.TestCase):
    """The run() value is what the worker process status is built from."""

    def test_worker_script_maps_success_to_zero_and_failure_to_one(self):
        worker_script = os.path.join(REPO_ROOT, "scripts", "__cmsWorker")
        with open(worker_script, encoding="utf-8") as script:
            self.assertIn("return 0 if success is True else 1", script.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
