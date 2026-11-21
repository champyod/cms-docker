#!/usr/bin/env python3

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

"""Tests for the datetime helpers.

"""

from types import SimpleNamespace
import unittest

import babel.dates

from cmscommon.datetime import get_timezone, local_tz


ROME = babel.dates.get_timezone("Europe/Rome")
BANGKOK = babel.dates.get_timezone("Asia/Bangkok")


def contest_with(timezone: str | None) -> SimpleNamespace:
    return SimpleNamespace(timezone=timezone)


def user_with(timezone: str | None) -> SimpleNamespace:
    return SimpleNamespace(timezone=timezone)


class TestGetTimezone(unittest.TestCase):

    def test_it_prefers_the_users_timezone(self):
        self.assertEqual(
            get_timezone(user_with("Europe/Rome"), contest_with("Asia/Bangkok")),
            ROME)

    def test_it_falls_back_to_the_contest_timezone(self):
        self.assertEqual(
            get_timezone(user_with(None), contest_with("Asia/Bangkok")),
            BANGKOK)
        self.assertEqual(
            get_timezone(None, contest_with("Asia/Bangkok")),
            BANGKOK)

    def test_it_falls_back_to_the_server_timezone(self):
        self.assertIs(get_timezone(None, contest_with(None)), local_tz)

    def test_it_ignores_an_unknown_user_zone(self):
        self.assertEqual(
            get_timezone(user_with("Not/AZone"), contest_with("Asia/Bangkok")),
            BANGKOK)

    def test_it_ignores_an_unknown_contest_zone(self):
        self.assertIs(get_timezone(None, contest_with("Not/AZone")), local_tz)
