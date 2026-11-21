#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2019 Luca Wehrstedt <luca.wehrstedt@gmail.com>
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

"""Tests for the the mimetypes module"""

import unittest

from cmscommon.mimetypes import get_icon_for_type, get_name_for_type, \
    get_type_for_file_name


class TestGetIconForType(unittest.TestCase):

    def test_it_returns_the_custom_icon(self):
        self.assertEqual(get_icon_for_type("application/x-tar"),
                         "package-x-generic")

    def test_it_resolves_an_aliased_mime_type(self):
        self.assertEqual(get_icon_for_type("application/x-tex"),
                         "text-x-generic")

    def test_it_falls_back_to_a_generic_icon(self):
        self.assertEqual(get_icon_for_type("video/x-foobar"),
                         "video-x-generic")


class TestGetNameForType(unittest.TestCase):

    def test_it_returns_the_localised_name(self):
        self.assertEqual(get_name_for_type("application/pdf", "en", "en"),
                         "PDF document")

    def test_it_resolves_an_aliased_mime_type(self):
        self.assertEqual(get_name_for_type("text/x-octave", "en", "en"),
                         "MATLAB file")


class TestGetTypeForFileName(unittest.TestCase):

    def test_it_uses_the_file_extension(self):
        self.assertEqual(get_type_for_file_name("foo.pdf"),
                         "application/pdf")

    def test_it_recognises_a_known_name_without_extension(self):
        self.assertEqual(get_type_for_file_name("Makefile"),
                         "text/x-makefile")

    def test_it_returns_none_for_an_unknown_name(self):
        self.assertIsNone(get_type_for_file_name("foobar"))
