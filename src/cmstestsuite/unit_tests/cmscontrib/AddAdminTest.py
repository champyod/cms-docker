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

"""Tests for the AddAdmin script"""

import unittest

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin

from cms.db import Admin, Group
from cmscommon.crypto import validate_password
from cmscontrib.AddAdmin import add_admin


class TestAddAdmin(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()
        if self.session.query(Group).filter(Group.name == "Superadmin").first() is None:
            self.session.add(Group(name="Superadmin", description="Superadmin"))
            self.session.commit()

    def tearDown(self):
        self.delete_data()
        super().tearDown()

    def assertAdminInDb(self, username, pwd, name, enabled):
        """Assert that the admin with the given data is in the DB."""
        self.session.expire_all()
        db_admins = self.session.query(Admin)\
            .filter(Admin.username == username).all()
        self.assertEqual(len(db_admins), 1)
        a = db_admins[0]
        self.assertTrue(validate_password(a.authentication, pwd))
        self.assertEqual(a.name, name)
        self.assertEqual(a.enabled, enabled)
        self.assertTrue(any(ag.group.name == "Superadmin" for ag in a.admin_groups))

    def test_success(self):
        self.assertTrue(add_admin("name", "pwd"))
        self.assertAdminInDb("name", "pwd", "name", True)

    def test_dont_overwrite(self):
        self.assertTrue(add_admin("name", "pwd"))
        self.assertFalse(add_admin("name", "other"))
        self.assertAdminInDb("name", "pwd", "name", True)


if __name__ == "__main__":
    unittest.main()
