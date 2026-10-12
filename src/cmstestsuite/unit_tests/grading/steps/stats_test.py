#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2018 Stefano Maggiolo <s.maggiolo@gmail.com>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Tests for stats.py."""

import unittest

from cms.grading.Sandbox import Sandbox
from cms.grading.steps import execution_stats, merge_execution_stats
from cmstestsuite.unit_tests.grading.steps.fakeisolatesandbox \
    import FakeIsolateSandbox


INVALID_UTF8 = b"\xc3\x28"


def get_stats(execution_time, execution_wall_clock_time, execution_memory,
              exit_status, signal=None, stdout=None, stderr=None):
    stats = {
        "execution_time": execution_time,
        "execution_wall_clock_time": execution_wall_clock_time,
        "execution_memory": execution_memory,
        "exit_status": exit_status,
    }
    if signal is not None:
        stats["signal"] = signal
    if stdout is not None:
        stats["stdout"] = stdout
    if stderr is not None:
        stats["stderr"] = stderr
    return stats


class TestExecutionStats(unittest.TestCase):

    def setUp(self):
        super().setUp()
        self.sandbox = FakeIsolateSandbox(None)
        self.sandbox.stdout_file = "stdout.txt"
        self.sandbox.stderr_file = "stderr.txt"

    def test_it_collects_the_execution_values(self):
        # Tell the fake sandbox the command data to fake, and execute it.
        self.sandbox.fake_execute_data(
            True, b"o", b"e", 0.1, 0.5, 1000, "OK")
        self.sandbox.execute_without_std(["command"], wait=True)

        stats = execution_stats(self.sandbox)
        self.assertEqual(stats,
                         get_stats(0.1, 0.5, 1000 * 1024, Sandbox.EXIT_OK))

    def test_it_records_the_signal_when_the_process_is_killed(self):
        self.sandbox.fake_execute_data(
            True, b"o", b"e", 0.1, 0.5, 1000, "SG", signal=11)
        self.sandbox.execute_without_std(["command"], wait=True)

        stats = execution_stats(self.sandbox)
        self.assertEqual(stats,
                         get_stats(0.1, 0.5, 1000 * 1024, Sandbox.EXIT_SIGNAL,
                                   signal=11))

    def test_it_collects_stdout_and_stderr_when_asked(self):
        self.sandbox.fake_execute_data(
            True, b"o", b"e", 0.1, 0.5, 1000, "OK")
        self.sandbox.execute_without_std(["command"], wait=True)

        stats = execution_stats(self.sandbox, collect_output=True)
        self.assertEqual(stats,
                         get_stats(0.1, 0.5, 1000 * 1024, Sandbox.EXIT_OK,
                                   stdout="o", stderr="e"))

    def test_it_replaces_invalid_utf8_in_the_output(self):
        self.sandbox.fake_execute_data(
            True,
            b"o" + INVALID_UTF8 + b"1",
            b"e" + INVALID_UTF8 + b"2",
            0.1, 0.5, 1000, "OK")

        self.sandbox.execute_without_std(["command"], wait=True)

        stats = execution_stats(self.sandbox, collect_output=True)

        # UTF-8 invalid parts are replaced with funny question marks (\uFFFD).
        self.assertRegex(stats["stdout"], "^o.*1$")
        self.assertRegex(stats["stderr"], "^e.*2$")


class TestSandboxMemoryUsed(unittest.TestCase):

    def setUp(self):
        super().setUp()
        self.sandbox = FakeIsolateSandbox(None)
        self.sandbox.stdout_file = "stdout.txt"
        self.sandbox.stderr_file = "stderr.txt"

    def test_it_falls_back_to_max_rss_when_cg_mem_is_absent(self):
        # isolate emits max-rss alone on kernels with no memory.peak
        # (before Linux 6.8), which is the case on the grading host.
        self.sandbox.fake_execute_data(
            True, b"o", b"e", 0.1, 0.5, 1000, "OK")
        self.sandbox.execute_without_std(["command"], wait=True)

        self.assertEqual(self.sandbox.get_memory_used(), 1000 * 1024)
        self.assertEqual(execution_stats(self.sandbox)["execution_memory"],
                         1000 * 1024)

    def test_it_prefers_cg_mem_over_max_rss(self):
        # On kernels with memory.peak isolate emits both keys, and the
        # cgroup peak is the one that covers every process of the
        # evaluation, so it has to win over the main process alone.
        self.sandbox.fake_execute_data(
            True, b"o", b"e", 0.1, 0.5, 1000, "OK", cgroup_memory=2000)
        self.sandbox.execute_without_std(["command"], wait=True)

        self.assertEqual(self.sandbox.get_memory_used(), 2000 * 1024)

    def test_it_is_none_when_no_memory_key_is_reported(self):
        self.sandbox.fake_execute_data(
            True, b"o", b"e", 0.1, 0.5, None, "OK")
        self.sandbox.execute_without_std(["command"], wait=True)

        self.assertIsNone(self.sandbox.get_memory_used())


class TestMergeExecutionStats(unittest.TestCase):

    def assertStats(self, r0, r1):
        """Assert that r0 and r1 are the same result."""
        self.assertAlmostEqual(r0["execution_time"], r1["execution_time"])
        self.assertAlmostEqual(r0["execution_wall_clock_time"],
                               r1["execution_wall_clock_time"])
        self.assertAlmostEqual(r0["execution_memory"], r1["execution_memory"])
        self.assertEqual(r0["exit_status"], r1["exit_status"])

        # Optional keys.
        for key in ["signal", "stdout", "stderr"]:
            self.assertEqual(key in r0, key in r1, key)
            self.assertEqual(r0.get(key), r1.get(key))

    def test_it_adds_times_and_memory_for_two_ok_runs(self):
        self.assertStats(
            merge_execution_stats(
                get_stats(1.0, 2.0, 300, Sandbox.EXIT_OK),
                get_stats(0.1, 0.2, 0.3, Sandbox.EXIT_OK)),
            get_stats(1.1, 2.0, 300.3, Sandbox.EXIT_OK))

    def test_it_keeps_the_maximum_memory_for_sequential_runs(self):
        # In non-concurrent mode memory is max'd and wall clock is added.
        self.assertStats(
            merge_execution_stats(
                get_stats(1.0, 2.0, 300, Sandbox.EXIT_OK),
                get_stats(0.1, 0.2, 0.3, Sandbox.EXIT_OK),
                concurrent=False),
            get_stats(1.1, 2.2, 300.0, Sandbox.EXIT_OK))

    def test_it_prefers_the_second_status_when_the_first_succeeded(self):
        self.assertStats(
            merge_execution_stats(
                get_stats(0, 0, 0, Sandbox.EXIT_OK),
                get_stats(0, 0, 0, Sandbox.EXIT_TIMEOUT)),
            get_stats(0, 0, 0, Sandbox.EXIT_TIMEOUT))
        self.assertStats(
            merge_execution_stats(
                get_stats(0, 0, 0, Sandbox.EXIT_OK),
                get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=11)),
            get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=11))
        self.assertStats(
            merge_execution_stats(
                get_stats(0, 0, 0, Sandbox.EXIT_OK),
                get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=11)),
            get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=11))

    def test_it_keeps_the_first_status_when_it_failed(self):
        self.assertStats(
            merge_execution_stats(
                get_stats(0, 0, 0, Sandbox.EXIT_TIMEOUT),
                get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=11)),
            get_stats(0, 0, 0, Sandbox.EXIT_TIMEOUT))
        self.assertStats(
            merge_execution_stats(
                get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=9),
                get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=11)),
            get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=9))
        self.assertStats(
            merge_execution_stats(
                get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=9),
                get_stats(0, 0, 0, Sandbox.EXIT_OK)),
            get_stats(0, 0, 0, Sandbox.EXIT_SIGNAL, signal=9))

    def test_it_does_not_modify_the_input_stats(self):
        r0 = get_stats(1.0, 2.0, 300, Sandbox.EXIT_OK)
        r1 = get_stats(0.1, 0.2, 0.3, Sandbox.EXIT_SIGNAL, signal=11)
        m = merge_execution_stats(r0, r1)
        self.assertStats(
            m, get_stats(1.1, 2.0, 300.3, Sandbox.EXIT_SIGNAL, signal=11))
        self.assertStats(
            r0, get_stats(1.0, 2.0, 300, Sandbox.EXIT_OK))
        self.assertStats(
            r1, get_stats(0.1, 0.2, 0.3, Sandbox.EXIT_SIGNAL, signal=11))

    def test_it_copies_the_second_stats_when_the_first_is_none(self):
        r1 = get_stats(0.1, 0.2, 0.3, Sandbox.EXIT_SIGNAL, signal=11)
        m = merge_execution_stats(None, r1)
        self.assertStats(m, r1)
        self.assertIsNot(r1, m)

    def test_it_joins_the_outputs_with_a_separator(self):
        r0 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o1", stderr="e1")
        r1 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o2", stderr="e2")
        m = merge_execution_stats(r0, r1)
        self.assertStats(
            m, get_stats(0, 0, 0, Sandbox.EXIT_OK,
                         stdout="o1\n===\no2", stderr="e1\n===\ne2"))

    def test_it_keeps_the_output_present_in_either_run(self):
        r0 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o1")
        r1 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stderr="e2")
        m = merge_execution_stats(r0, r1)
        self.assertStats(
            m, get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o1", stderr="e2"))

    def test_it_rejects_a_second_stats_that_is_none(self):
        with self.assertRaises(ValueError):
            merge_execution_stats(None, None)

        r0 = get_stats(0.1, 0.2, 0.3, Sandbox.EXIT_OK)
        with self.assertRaises(ValueError):
            merge_execution_stats(r0, None)

    def test_empty_outputs_are_preserved(self):
        r0 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o1", stderr="")
        r1 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="", stderr="e2")
        m = merge_execution_stats(r0, r1)
        self.assertStats(
            m, get_stats(0, 0, 0, Sandbox.EXIT_OK,
                         stdout="o1\n===\n", stderr="\n===\ne2"))

    def test_missing_outputs_are_not_preserved(self):
        r0 = get_stats(0, 0, 0, Sandbox.EXIT_OK)
        r1 = get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o2", stderr="e2")
        m = merge_execution_stats(r0, r1)
        self.assertStats(
            m, get_stats(0, 0, 0, Sandbox.EXIT_OK, stdout="o2", stderr="e2"))


if __name__ == "__main__":
    unittest.main()
