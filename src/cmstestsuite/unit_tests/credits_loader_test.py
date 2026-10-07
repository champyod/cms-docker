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
itself, and the failure cases build their own tree in a temporary directory
rather than touching the one in the checkout.
"""

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
        with tempfile.TemporaryDirectory() as elsewhere:
            previous = os.getcwd()
            os.chdir(elsewhere)
            try:
                found = find_credits_file()
            finally:
                os.chdir(previous)
        self.assertEqual(found, EXPECTED_CREDITS_FILE)
        self.assertTrue(found.is_file())

    def test_configured_path_wins_over_the_upward_search(self):
        # WHY a start directory with no file of its own: it stands in for the
        # installed package of a container, where the walk reaches nothing and
        # only the configured path can supply the credits.
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
            with self.assertRaises(CreditsError) as context:
                load_credits(Path(tree))
        self.assertIn("not valid JSON", str(context.exception))

    def test_file_that_is_not_an_object_is_rejected(self):
        with tempfile.TemporaryDirectory() as tree:
            listed = Path(tree) / CREDITS_FILE_NAME
            listed.write_text("[]", encoding="utf-8")
            with self.assertRaises(CreditsError) as context:
                load_credits(Path(tree))
        self.assertIn("JSON object", str(context.exception))

    def test_contest_surface_is_returned(self):
        surface = get_surface("contest")
        self.assertEqual(surface, load_credits()["surfaces"]["contest"])
        self.assertEqual(
            [asset["name"] for asset in surface["assets"]],
            ["jQuery 3.6.0", "jQuery Migrate 3.3.2", "Bootstrap 2.0.4",
             "Tango icon theme"])
        self.assertTrue(surface["attribution"])

    def test_unknown_surface_is_rejected(self):
        with self.assertRaises(CreditsError) as context:
            get_surface("no-such-surface")
        self.assertIn("no-such-surface", str(context.exception))


if __name__ == "__main__":
    unittest.main()