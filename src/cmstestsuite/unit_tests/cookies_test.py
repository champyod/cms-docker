#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2018 Luca Wehrstedt <luca.wehrstedt@gmail.com>
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

"""Tests for the shared authentication-cookie attributes."""

import os
import unittest
from unittest import mock

from cmscommon.cookies import cookie_secure, session_cookie_attributes


class CookieSecurityTest(unittest.TestCase):
    def test_secure_is_the_default(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertTrue(cookie_secure())

    def test_explicit_false_values_enable_local_http(self):
        for value in ("0", "false", "no", "off", " FALSE "):
            with self.subTest(value=value), mock.patch.dict(
                    os.environ, {"COOKIE_SECURE": value}, clear=True):
                self.assertFalse(cookie_secure())

    def test_an_invalid_value_stays_secure(self):
        with mock.patch.dict(os.environ, {"COOKIE_SECURE": "unexpected"}, clear=True):
            self.assertTrue(cookie_secure())

    def test_every_session_cookie_is_http_only_and_lax(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(session_cookie_attributes(), {
                "secure": True,
                "httponly": True,
                "samesite": "Lax",
            })


if __name__ == "__main__":
    unittest.main()
