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

"""Tests for the AddParticipation script"""

import ipaddress
import unittest

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin

from cms.db import Participation
from cmscommon.crypto import hash_password, parse_authentication, \
    validate_password
from cmscontrib.AddParticipation import add_participation


class TestAddParticipation(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()
        self.contest = self.add_contest()
        self.user = self.add_user()
        self.team = self.add_team()
        self.session.commit()

    def tearDown(self):
        self.delete_data()
        super().tearDown()

    def assertParticipationInDb(self, user_id, contest_id, password,
                                delay_time=0, extra_time=0,
                                hidden=False, unrestricted=False,
                                ip=None, team_code=None):
        """Assert that the participation with the given data is in the DB."""
        db_participations = self.session.query(Participation)\
            .filter(Participation.user_id == user_id)\
            .filter(Participation.contest_id == contest_id).all()
        self.assertEqual(len(db_participations), 1)
        p = db_participations[0]
        self.assertTrue(validate_password(p.password, password))
        self.assertEqual(p.hidden, hidden)
        self.assertEqual(p.unrestricted, unrestricted)
        if ip is None:
            self.assertIsNone(p.ip)
        else:
            self.assertCountEqual(p.ip, ip)
        if team_code is None:
            self.assertIsNone(p.team)
        else:
            self.assertEqual(p.team.code, team_code)

    def test_it_adds_the_participation_for_the_user(self):
        self.assertTrue(add_participation(
            self.user.username, self.contest.id, None, None, None,
            "pwd", "bcrypt", False, None, False, False))
        self.assertParticipationInDb(self.user.id, self.contest.id, "pwd")

    def test_it_stores_the_team_code_on_the_participation(self):
        self.assertTrue(add_participation(
            self.user.username, self.contest.id, None, None, None,
            "pwd", "bcrypt", False, self.team.code, False, False))
        self.assertParticipationInDb(self.user.id, self.contest.id, "pwd",
                                     team_code=self.team.code)

    def test_it_fails_when_the_user_is_missing(self):
        self.assertFalse(add_participation(
            self.user.username + "_", self.contest.id, None, None, None,
            "pwd", "bcrypt", False, None, False, False))

    def test_it_fails_when_the_contest_is_missing(self):
        self.assertFalse(add_participation(
            self.user.username, self.contest.id + 1, None, None, None,
            "pwd", "bcrypt", False, None, False, False))

    def test_it_fails_when_the_team_is_missing(self):
        self.assertFalse(add_participation(
            self.user.username, self.contest.id, None, None, None,
            "pwd", "bcrypt", False, self.team.code + "_", False, False))

    def test_it_keeps_the_existing_participation_unchanged(self):
        self.assertTrue(add_participation(
            self.user.username, self.contest.id, None, None, None,
            "pwd", "bcrypt", False, None, False, False))
        self.assertParticipationInDb(self.user.id, self.contest.id, "pwd")

        # Second add_participation should fail without changing values.
        self.assertFalse(add_participation(
            self.user.username, self.contest.id + 1, "1.2.3.4", 60, 120,
            parse_authentication(hash_password("other_pwd"))[1], "bcrypt",
            True, self.team.code, True, True))
        self.assertParticipationInDb(self.user.id, self.contest.id, "pwd")

    def test_it_stores_the_optional_participation_fields(self):
        self.assertTrue(add_participation(
            self.user.username, self.contest.id, "1.2.3.4", 60, 120,
            parse_authentication(hash_password("pwd"))[1], "bcrypt", True,
            None, True, True))
        self.assertParticipationInDb(self.user.id, self.contest.id, "pwd",
                                     delay_time=60, extra_time=120,
                                     hidden=True, unrestricted=True,
                                     ip=[ipaddress.ip_network("1.2.3.4")])


if __name__ == "__main__":
    unittest.main()
