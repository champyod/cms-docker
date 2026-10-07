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

"""Tests for the loader of the credits file.

Every case is deterministic: the file is located relative to the module
itself, the failure cases build their own tree in a temporary directory
rather than touching the one in the checkout, and every case pins
$CMS_CREDITS_FILE itself instead of inheriting the one the process happens to
carry. A case that inherited it would pass in a checkout and read a different
file inside the image, which is the situation these tests exist to pin down.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cms.server.credits import (
    CREDITS_FILE_ENV_VAR,
    CREDITS_FILE_NAME,
    CreditsError,
    find_credits_file,
    get_surface,
    load_credits,
)

EXPECTED_CREDITS_FILE = Path(__file__).resolve().parents[3] / CREDITS_FILE_NAME


class CreditsFileTest(unittest.TestCase):

    def test_file_is_found_from_any_working_directory(self):
        # WHY chdir: the process cwd is where a relative lookup would read
        # from, so a loader that accidentally relied on it would pass every
        # test run from the package directory and fail in the container.
        with mock.patch.dict(os.environ):
            os.environ.pop(CREDITS_FILE_ENV_VAR, None)
            with tempfile.TemporaryDirectory() as elsewhere:
                previous = os.getcwd()
                os.chdir(elsewhere)
                try:
                    found = find_credits_file()
                finally:
                    os.chdir(previous)
        self.assertEqual(found, EXPECTED_CREDITS_FILE)
        self.assertTrue(found.is_file())

    def test_configured_path_is_used_when_no_start_is_given(self):
        # WHY no start: this is the installed package of a container, where the
        # walk reaches nothing and only the configured path can supply the
        # credits. Every production caller passes no start.
        with tempfile.TemporaryDirectory() as tree:
            configured = Path(tree) / "credits-override.json"
            configured.write_text('{"surfaces": {}}', encoding="utf-8")
            with mock.patch.dict(os.environ,
                                 {CREDITS_FILE_ENV_VAR: str(configured)}):
                found = find_credits_file()
        self.assertEqual(found, configured)

    def test_explicit_start_wins_over_the_configured_path(self):
        # WHY two files: a caller that names its own tree must not be answered
        # from a path an operator configured for a different one.
        with tempfile.TemporaryDirectory() as tree:
            found = Path(tree) / CREDITS_FILE_NAME
            found.write_text("{}", encoding="utf-8")
            configured = Path(tree) / "credits-override.json"
            configured.write_text('{"surfaces": {}}', encoding="utf-8")
            with mock.patch.dict(os.environ,
                                 {CREDITS_FILE_ENV_VAR: str(configured)}):
                self.assertEqual(find_credits_file(Path(tree)), found)

    def test_configured_path_is_the_fallback_of_an_explicit_start(self):
        # WHY a start whose walk reaches nothing: that is the case the variable
        # exists for, a tree that holds no credits file of its own.
        with tempfile.TemporaryDirectory() as tree:
            configured = Path(tree) / "credits-override.json"
            configured.write_text('{"surfaces": {}}', encoding="utf-8")
            with mock.patch.dict(os.environ,
                                 {CREDITS_FILE_ENV_VAR: str(configured)}):
                found = find_credits_file(Path(tree) / "pkg")
        self.assertEqual(found, configured)

    def test_unset_variable_keeps_the_upward_search(self):
        with mock.patch.dict(os.environ):
            os.environ.pop(CREDITS_FILE_ENV_VAR, None)
            self.assertEqual(find_credits_file(), EXPECTED_CREDITS_FILE)

    def test_configured_path_that_is_not_a_file_falls_back_to_the_search(self):
        with tempfile.TemporaryDirectory() as tree:
            found = Path(tree) / CREDITS_FILE_NAME
            found.write_text("{}", encoding="utf-8")
            absent = Path(tree) / "no-such-file.json"
            with mock.patch.dict(os.environ,
                                 {CREDITS_FILE_ENV_VAR: str(absent)}):
                self.assertEqual(find_credits_file(Path(tree)), found)

    def test_missing_file_names_the_file_and_the_search(self):
        with tempfile.TemporaryDirectory() as empty:
            with mock.patch.dict(os.environ):
                os.environ.pop(CREDITS_FILE_ENV_VAR, None)
                with self.assertRaises(CreditsError) as context:
                    find_credits_file(Path(empty))
        message = str(context.exception)
        self.assertIn(CREDITS_FILE_NAME, message)
        self.assertIn(empty, message)

    def test_missing_file_names_a_configured_path_that_is_not_a_file(self):
        with tempfile.TemporaryDirectory() as empty:
            configured = Path(empty) / "absent.json"
            with mock.patch.dict(os.environ,
                                 {CREDITS_FILE_ENV_VAR: str(configured)}):
                with self.assertRaises(CreditsError) as context:
                    find_credits_file(Path(empty))
        message = str(context.exception)
        self.assertIn(CREDITS_FILE_NAME, message)
        self.assertIn(str(configured), message)
        self.assertIn(empty, message)

    def test_malformed_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tree:
            broken = Path(tree) / CREDITS_FILE_NAME
            broken.write_text("{ this is not json", encoding="utf-8")
            with mock.patch.dict(os.environ):
                os.environ.pop(CREDITS_FILE_ENV_VAR, None)
                with self.assertRaises(CreditsError) as context:
                    load_credits(Path(tree))
        self.assertIn("not valid JSON", str(context.exception))

    def test_file_that_is_not_an_object_is_rejected(self):
        with tempfile.TemporaryDirectory() as tree:
            listed = Path(tree) / CREDITS_FILE_NAME
            listed.write_text("[]", encoding="utf-8")
            with mock.patch.dict(os.environ):
                os.environ.pop(CREDITS_FILE_ENV_VAR, None)
                with self.assertRaises(CreditsError) as context:
                    load_credits(Path(tree))
        self.assertIn("JSON object", str(context.exception))

    def test_the_cache_follows_the_configured_path(self):
        # WHY one start and two values of the variable: a cache keyed on start
        # alone would hand the first file back to the second, which is what a
        # test suite and a server configured at different times each see.
        with mock.patch.dict(os.environ):
            os.environ.pop(CREDITS_FILE_ENV_VAR, None)
            from_checkout = load_credits()
            with tempfile.TemporaryDirectory() as tree:
                configured = Path(tree) / CREDITS_FILE_NAME
                configured.write_text('{"surfaces": {"contest": "override"}}',
                                      encoding="utf-8")
                os.environ[CREDITS_FILE_ENV_VAR] = str(configured)
                from_image = load_credits()
        self.assertEqual(
            from_checkout,
            json.loads(EXPECTED_CREDITS_FILE.read_text(encoding="utf-8")))
        self.assertEqual(from_image["surfaces"]["contest"], "override")

    def test_contest_surface_is_returned(self):
        with mock.patch.dict(os.environ):
            os.environ.pop(CREDITS_FILE_ENV_VAR, None)
            surface = get_surface("contest")
            self.assertEqual(surface, load_credits()["surfaces"]["contest"])
        self.assertEqual(
            [asset["name"] for asset in surface["assets"]],
            ["jQuery 3.6.0", "jQuery Migrate 3.3.2", "Bootstrap 2.0.4",
             "Tango icon theme"])
        self.assertTrue(surface["attribution"])

    def test_unknown_surface_is_rejected(self):
        with mock.patch.dict(os.environ):
            os.environ.pop(CREDITS_FILE_ENV_VAR, None)
            with self.assertRaises(CreditsError) as context:
                get_surface("no-such-surface")
        self.assertIn("no-such-surface", str(context.exception))


if __name__ == "__main__":
    unittest.main()