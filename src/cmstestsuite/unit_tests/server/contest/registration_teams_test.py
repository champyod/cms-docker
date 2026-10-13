#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
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

"""Tests for the registerable-team filter used by CWS registration."""

import unittest

from sqlalchemy.orm.exc import NoResultFound

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin

from cms.server.contest.handlers.main import (
    find_registerable_team, selectable_teams)


class TestRegistrationTeams(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()

        self.contestant_team = self.add_team(
            code="MWIT-Oct-69", name="MWIT-Oct-69", registerable=True)
        self.add_team(code="Teacher", name="Teacher", registerable=False)
        self.add_team(
            code="Teacher-Assistants", name="Teacher Assistants",
            registerable=False)

        self.session.commit()

    def tearDown(self):
        self.delete_data()
        super().tearDown()

    def test_selectable_teams_omits_staff_teams(self):
        codes = {team.code for team in selectable_teams(self.session)}
        self.assertEqual(codes, {"MWIT-Oct-69"})

    def test_find_registerable_team_returns_contestant_team(self):
        team = find_registerable_team(
            self.session, self.contestant_team.code)
        self.assertEqual(team.code, self.contestant_team.code)

    def test_find_registerable_team_refuses_a_staff_team(self):
        with self.assertRaises(NoResultFound):
            find_registerable_team(self.session, "Teacher")


if __name__ == "__main__":
    unittest.main()
