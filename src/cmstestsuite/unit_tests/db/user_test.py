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

"""Tests for the password a User row is created with."""

import unittest
from unittest.mock import patch

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin
from cmstestsuite.unit_tests.testidgenerator import unique_unicode_id

from cms.db import User
from cmscommon.crypto import parse_authentication, validate_password


# The password generate_random_password() is made to return, so the test knows
# the secret a default-created row was built from.
GENERATED_PASSWORD = "generated-password"


class TestUserPasswordDefault(DatabaseMixin, unittest.TestCase):
    """Tests for the default of User.password."""

    def insert_user_with_default_password(self):
        """Insert a user naming every column except the password.

        The core insert (rather than the ORM constructor) is what makes
        SQLAlchemy evaluate the column's callable default; the ORM's set_attrs
        stores the callable itself, a pre-existing quirk unrelated to this
        default.
        """
        username = unique_unicode_id()
        self.session.execute(
            User.__table__.insert().values(
                first_name=unique_unicode_id(),
                last_name=unique_unicode_id(),
                username=username))
        self.session.flush()
        return self.session.query(User.password) \
            .filter(User.username == username).scalar()

    def test_a_new_row_authenticates_with_the_generated_password(self):
        with patch("cms.db.user.generate_random_password",
                   return_value=GENERATED_PASSWORD):
            authentication = self.insert_user_with_default_password()

        self.assertEqual(parse_authentication(authentication)[0], "bcrypt")
        self.assertNotIn(GENERATED_PASSWORD, authentication)
        self.assertTrue(validate_password(authentication, GENERATED_PASSWORD))
        self.assertFalse(
            validate_password(authentication, GENERATED_PASSWORD + "x"))


if __name__ == "__main__":
    unittest.main()
