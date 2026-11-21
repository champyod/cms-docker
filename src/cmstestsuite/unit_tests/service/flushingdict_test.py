#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2016 Stefano Maggiolo <s.maggiolo@gmail.com>
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

"""Tests for the flushing dict module."""

import unittest

import gevent

from cms.service.flushingdict import FlushingDict


class TestFlushingDict(unittest.TestCase):

    SIZE = 3
    FLUSH_LATENCY_SECONDS = 0.2

    def setUp(self):
        super().setUp()
        self.received_data = []
        self.d = FlushingDict(
            TestFlushingDict.SIZE, TestFlushingDict.FLUSH_LATENCY_SECONDS,
            self.callback)

    def test_it_flushes_after_the_latency_expires(self):
        self.d.add(0, 0)
        gevent.sleep(2 * TestFlushingDict.FLUSH_LATENCY_SECONDS)
        self.assertEqual(1, len(self.received_data))
        self.assertCountEqual([(0, 0)], self.received_data[0])

    def test_it_flushes_when_the_size_is_reached(self):
        expected_data = []
        for i in range(TestFlushingDict.SIZE):
            self.d.add(i, i)
            expected_data.append((i, i))
        gevent.sleep(0)
        self.assertEqual(1, len(self.received_data))
        self.assertCountEqual(expected_data, self.received_data[0])

    def test_it_flushes_on_size_then_on_latency(self):
        expected_data = []
        for i in range(TestFlushingDict.SIZE):
            self.d.add(i, i)
            expected_data.append((i, i))
        gevent.sleep(0)
        self.assertEqual(1, len(self.received_data))
        self.assertCountEqual(expected_data, self.received_data[0])
        self.d.add(TestFlushingDict.SIZE, TestFlushingDict.SIZE)
        gevent.sleep(TestFlushingDict.FLUSH_LATENCY_SECONDS + 0.1)
        self.assertEqual(2, len(self.received_data))
        self.assertCountEqual(
            [(TestFlushingDict.SIZE, TestFlushingDict.SIZE)],
            self.received_data[1])

    def test_it_does_not_lose_elements_while_the_callback_runs(self):
        self.d = FlushingDict(
            TestFlushingDict.SIZE, TestFlushingDict.FLUSH_LATENCY_SECONDS,
            self.long_callback)
        expected_data = []
        for i in range(TestFlushingDict.SIZE):
            self.d.add(i, i)
            expected_data.append((i, i))

        # We add another element while the callback is idling, to see
        # if the new element is flushed later. We need to wait 2
        # latencies for the callback, one more for the time-based
        # second flush, and we add some tolerance.
        gevent.sleep(0)
        self.d.add(TestFlushingDict.SIZE, TestFlushingDict.SIZE)
        gevent.sleep((TestFlushingDict.FLUSH_LATENCY_SECONDS + 0.1) * 3)

        self.assertEqual(TestFlushingDict.SIZE + 1,
                         sum(len(data) for data in self.received_data))

    def test_it_flushes_many_elements_across_batches(self):
        expected_data = []
        for i in range(20):
            self.d.add(i, i)
            expected_data.append((i, i))
        gevent.sleep(TestFlushingDict.FLUSH_LATENCY_SECONDS + 0.1)
        self.assertCountEqual(expected_data, sum(self.received_data, []))

    def callback(self, data):
        self.received_data.append(data)

    def long_callback(self, data):
        gevent.sleep(TestFlushingDict.FLUSH_LATENCY_SECONDS * 2)
        self.callback(data)


if __name__ == "__main__":
    unittest.main()
