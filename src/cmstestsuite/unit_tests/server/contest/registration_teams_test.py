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

from cms.db import ContestTeam, engine
from cms.server.contest.handlers.main import (
    find_registerable_team, selectable_teams)


class TestRegistrationTeams(DatabaseMixin, unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # WHY: contest_teams is Prisma-owned, so cmsInitDB never creates it;
        # build it here from the one ORM definition the CWS query reads.
        ContestTeam.__table__.create(engine, checkfirst=True)

    def setUp(self):
        super().setUp()

        self.contest = self.add_contest()
        self.contestant_team = self.add_team(
            code="MWIT-Oct-69", name="MWIT-Oct-69", registerable=True)
        self.staff_team = self.add_team(
            code="Teacher", name="Teacher", registerable=False)
        self.add_team(
            code="Teacher-Assistants", name="Teacher Assistants",
            registerable=False)

        self.session.commit()

    def add_roster_entry(self, team, registerable):
        """Add a contest_teams row overriding this team for the contest."""
        entry = ContestTeam(contest_id=self.contest.id, team_id=team.id,
                            registerable=registerable)
        self.session.add(entry)
        self.session.commit()
        return entry

    def tearDown(self):
        self.delete_data()
        super().tearDown()

    def test_no_roster_falls_back_to_the_team_default(self):
        codes = {team.code for team in
                 selectable_teams(self.session, self.contest)}
        self.assertEqual(codes, {"MWIT-Oct-69"})

    def test_roster_row_excludes_a_default_registerable_team(self):
        self.add_roster_entry(self.contestant_team, registerable=False)
        codes = {team.code for team in
                 selectable_teams(self.session, self.contest)}
        self.assertEqual(codes, set())

    def test_roster_row_includes_a_default_staff_team(self):
        self.add_roster_entry(self.staff_team, registerable=True)
        codes = {team.code for team in
                 selectable_teams(self.session, self.contest)}
        self.assertEqual(codes, {"MWIT-Oct-69", "Teacher"})

    def test_find_registerable_team_follows_the_contest_roster(self):
        team = find_registerable_team(
            self.session, self.contest, self.contestant_team.code)
        self.assertEqual(team.code, self.contestant_team.code)

    def test_find_registerable_team_refuses_a_narrowed_contest(self):
        self.add_roster_entry(self.contestant_team, registerable=False)
        with self.assertRaises(NoResultFound):
            find_registerable_team(
                self.session, self.contest, self.contestant_team.code)

    def test_find_registerable_team_refuses_a_staff_team(self):
        with self.assertRaises(NoResultFound):
            find_registerable_team(self.session, self.contest, "Teacher")


if __name__ == "__main__":
    unittest.main()
