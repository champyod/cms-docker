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

"""Tests that every password writer stores a bcrypt hash.

A stored password is what the login path validates, so a writer that stores the
raw secret (or that skips the hash) produces accounts that cannot log in. Each
test calls the entry point a script or importer actually uses, so the assertion
covers the real write and not a helper next to it.

"""

import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin

from cms.db import Participation, SessionGen, User
from cmscommon import crypto
from cmscommon.crypto import hash_password, parse_authentication, \
    validate_password
from cmscontrib.AddParticipation import add_participation
from cmscontrib.AddParticipation import main as add_participation_main
from cmscontrib.AddUser import add_user
from cmscontrib.AddUser import main as add_user_main
from cmscontrib.loaders.italy_yaml import YamlLoader
from cmscontrib.loaders.polygon import PolygonContestLoader, PolygonUserLoader
from cmscontrib.updaters.update_28 import Updater as Update28Updater
from cmstestsuite import StressTest
from cmstestsuite.unit_tests.testidgenerator import unique_unicode_id


# bcrypt's own limit, whether or not the module under test exposes it.
BCRYPT_MAX_PASSWORD_BYTES = getattr(crypto, "BCRYPT_MAX_PASSWORD_BYTES", 72)

# A password long enough that a chance occurrence inside a bcrypt payload is
# impossible, so "the secret is not stored" can be asserted literally.
RAW_PASSWORD = "correct horse battery staple"
TOO_LONG_PASSWORD = "a" * (BCRYPT_MAX_PASSWORD_BYTES + 1)


class PasswordAssertions:
    """Assertions shared by the writer tests."""

    def assertStoredAsBcrypt(self, authentication, raw_password):
        """Assert that authentication stores raw_password as a bcrypt hash."""
        method, payload = parse_authentication(authentication)
        self.assertEqual(method, "bcrypt")
        self.assertNotIn(raw_password, authentication)
        self.assertTrue(payload.startswith(("$2a$", "$2b$", "$2y$")))
        self.assertTrue(validate_password(authentication, raw_password))
        self.assertFalse(validate_password(authentication, raw_password + "x"))


class TestAddUser(DatabaseMixin, PasswordAssertions, unittest.TestCase):
    """Tests for the cmsAddUser writer."""

    def stored_password(self, username):
        with SessionGen() as session:
            return session.query(User.password) \
                .filter(User.username == username).one()[0]

    def test_it_stores_a_plaintext_password_as_a_bcrypt_hash(self):
        username = unique_unicode_id()
        self.assertTrue(add_user(
            "First", "Last", username, RAW_PASSWORD, "bcrypt", False,
            None, None, None))
        self.assertStoredAsBcrypt(
            self.stored_password(username), RAW_PASSWORD)

    def test_it_refuses_a_plaintext_method(self):
        username = unique_unicode_id()
        with self.assertRaises(ValueError):
            add_user("First", "Last", username, RAW_PASSWORD,
                     "plaintext", False, None, None, None)
        with SessionGen() as session:
            self.assertIsNone(
                session.query(User)
                .filter(User.username == username).first())

    def test_it_refuses_a_password_over_the_bcrypt_limit(self):
        with self.assertRaises(ValueError):
            add_user("First", "Last", "adduser_long", TOO_LONG_PASSWORD,
                     "bcrypt", False, None, None, None)

    def test_it_wraps_an_already_hashed_password(self):
        # --hashed-password takes the payload, without the "bcrypt:" prefix.
        payload = parse_authentication(hash_password(RAW_PASSWORD))[1]
        username = unique_unicode_id()
        self.assertTrue(add_user(
            "First", "Last", username, payload, "bcrypt", True,
            None, None, None))
        self.assertEqual(self.stored_password(username), "bcrypt:" + payload)

    def test_it_refuses_a_hashed_password_that_is_not_a_hash(self):
        with self.assertRaises(ValueError):
            add_user("First", "Last", "adduser_fake_hash", RAW_PASSWORD,
                     "bcrypt", True, None, None, None)

    def test_the_command_line_hashes_with_bcrypt_by_default(self):
        username = unique_unicode_id()
        with patch.object(sys, "argv", [
                "cmsAddUser", "First", "Last", username, "-p",
                RAW_PASSWORD]):
            self.assertEqual(add_user_main(), 0)
        self.assertStoredAsBcrypt(self.stored_password(username), RAW_PASSWORD)

    def test_the_command_line_refuses_to_be_told_plaintext(self):
        username = unique_unicode_id()
        stderr = io.StringIO()
        with patch.object(sys, "argv", [
                "cmsAddUser", "First", "Last", username, "-p",
                RAW_PASSWORD, "--method", "plaintext"]):
            with redirect_stderr(stderr):
                with self.assertRaises(SystemExit) as raised:
                    add_user_main()
        self.assertNotEqual(raised.exception.code, 0)
        # The refusal has to say why, not fail for lack of a flag.
        self.assertIn("not allowed", stderr.getvalue())
        self.assertIn("database", stderr.getvalue())
        with SessionGen() as session:
            self.assertIsNone(
                session.query(User)
                .filter(User.username == username).first())


class TestAddParticipation(DatabaseMixin, PasswordAssertions,
                           unittest.TestCase):
    """Tests for the cmsAddParticipation writer."""

    def setUp(self):
        super().setUp()
        self.contest = self.add_contest()
        self.user = self.add_user()
        self.session.commit()

    def stored_password(self):
        with SessionGen() as session:
            return session.query(Participation.password) \
                .filter(Participation.user_id == self.user.id) \
                .filter(Participation.contest_id == self.contest.id).one()[0]

    def test_it_stores_a_plaintext_password_as_a_bcrypt_hash(self):
        self.assertTrue(add_participation(
            self.user.username, self.contest.id, None, None, None,
            RAW_PASSWORD, "bcrypt", False, None, False, False))
        self.assertStoredAsBcrypt(self.stored_password(), RAW_PASSWORD)

    def test_it_refuses_a_plaintext_method(self):
        with self.assertRaises(ValueError):
            add_participation(
                self.user.username, self.contest.id, None, None, None,
                RAW_PASSWORD, "plaintext", False, None, False, False)

    def test_it_refuses_a_password_over_the_bcrypt_limit(self):
        with self.assertRaises(ValueError):
            add_participation(
                self.user.username, self.contest.id, None, None, None,
                TOO_LONG_PASSWORD, "bcrypt", False, None, False, False)

    def test_the_command_line_hashes_with_bcrypt_by_default(self):
        with patch.object(sys, "argv", [
                "cmsAddParticipation", self.user.username,
                "-c", str(self.contest.id), "-p", RAW_PASSWORD]):
            self.assertEqual(add_participation_main(), 0)
        self.assertStoredAsBcrypt(self.stored_password(), RAW_PASSWORD)

    def test_the_command_line_refuses_to_be_told_plaintext(self):
        stderr = io.StringIO()
        with patch.object(sys, "argv", [
                "cmsAddParticipation", self.user.username,
                "-c", str(self.contest.id), "-p", RAW_PASSWORD,
                "--method", "plaintext"]):
            with redirect_stderr(stderr):
                with self.assertRaises(SystemExit) as raised:
                    add_participation_main()
        self.assertNotEqual(raised.exception.code, 0)
        self.assertIn("not allowed", stderr.getvalue())
        self.assertIn("database", stderr.getvalue())


class TestPolygonLoader(PasswordAssertions, unittest.TestCase):
    """Tests for the Polygon importers."""

    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.contestants = os.path.join(self.directory.name, "contestants.txt")
        with open(self.contestants, "wt", encoding="utf-8") as file_:
            file_.write("contestant1;%s;Cont;Estant;0\n" % RAW_PASSWORD)

    def test_the_user_loader_hashes_the_password(self):
        # The loader hands its arguments to User(); this fork's User has no
        # "hidden" field, so the model is stubbed to observe the password
        # without depending on that unrelated defect.
        built = {}

        class StubUser:
            def __init__(self, **kwargs):
                built.update(kwargs)

        loader = PolygonUserLoader(
            os.path.join(self.directory.name, "contestant1"), None)
        with patch("cmscontrib.loaders.polygon.User", StubUser):
            self.assertIsInstance(loader.get_user(), StubUser)
        self.assertEqual(built["username"], "contestant1")
        self.assertStoredAsBcrypt(built["password"], RAW_PASSWORD)

    def test_the_contest_loader_hashes_the_participation_password(self):
        with open(os.path.join(self.directory.name, "contest.xml"),
                  "wt", encoding="utf-8") as file_:
            file_.write(
                "<contest><names><name language=\"english\" "
                "value=\"Contest\"/></names><problems/></contest>")
        loader = PolygonContestLoader(self.directory.name, None)
        _, _, participations = loader.get_contest()
        self.assertEqual(len(participations), 1)
        self.assertStoredAsBcrypt(
            participations[0]["password"], RAW_PASSWORD)

    def test_it_refuses_a_password_over_the_bcrypt_limit(self):
        with open(self.contestants, "wt", encoding="utf-8") as file_:
            file_.write("contestant1;%s;Cont;Estant;0\n" % TOO_LONG_PASSWORD)
        loader = PolygonUserLoader(
            os.path.join(self.directory.name, "contestant1"), None)
        with self.assertRaises(ValueError):
            loader.get_user()


class TestItalyYamlLoader(PasswordAssertions, unittest.TestCase):
    """Tests for the Italian YAML importer."""

    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.contest_path = os.path.join(self.directory.name, "contest")
        os.mkdir(self.contest_path)
        with open(os.path.join(self.contest_path, "contest.yaml"),
                  "wt", encoding="utf-8") as file_:
            file_.write(
                "name: contest\n"
                "description: A contest\n"
                "users:\n"
                "  - username: contestant1\n"
                "    password: %s\n"
                "    first_name: Cont\n"
                "    last_name: Estant\n" % RAW_PASSWORD)

    def test_the_user_loader_hashes_the_password(self):
        loader = YamlLoader(
            os.path.join(self.contest_path, "contestant1"), None)
        user = loader.get_user()
        self.assertEqual(user.username, "contestant1")
        self.assertStoredAsBcrypt(user.password, RAW_PASSWORD)

    def test_the_contest_loader_hashes_the_participation_password(self):
        loader = YamlLoader(self.contest_path, None)
        _, _, participations = loader.get_contest()
        self.assertEqual(len(participations), 1)
        self.assertStoredAsBcrypt(
            participations[0]["password"], RAW_PASSWORD)

    def test_it_refuses_a_password_over_the_bcrypt_limit(self):
        with open(os.path.join(self.contest_path, "contest.yaml"),
                  "wt", encoding="utf-8") as file_:
            file_.write(
                "name: contest\n"
                "description: A contest\n"
                "users:\n"
                "  - username: contestant1\n"
                "    password: %s\n" % TOO_LONG_PASSWORD)
        # The yaml loader caches by path; a new path avoids the cached copy.
        other_path = os.path.join(self.directory.name, "other")
        os.mkdir(other_path)
        os.rename(os.path.join(self.contest_path, "contest.yaml"),
                  os.path.join(other_path, "contest.yaml"))
        loader = YamlLoader(os.path.join(other_path, "contestant1"), None)
        with self.assertRaises(ValueError):
            loader.get_user()


class TestUpdate28(PasswordAssertions, unittest.TestCase):
    """Tests for the updater that introduces the password method."""

    def test_it_hashes_the_raw_password_of_a_user(self):
        updater = Update28Updater({
            "_version": 27,
            "user_1": {"_class": "User", "password": RAW_PASSWORD},
        })
        data = updater.run()
        self.assertStoredAsBcrypt(data["user_1"]["password"], RAW_PASSWORD)

    def test_it_hashes_the_raw_password_of_a_participation(self):
        updater = Update28Updater({
            "_version": 27,
            "participation_1": {"_class": "Participation",
                                "password": RAW_PASSWORD},
            "participation_2": {"_class": "Participation", "password": None},
        })
        data = updater.run()
        self.assertStoredAsBcrypt(
            data["participation_1"]["password"], RAW_PASSWORD)
        # An unset participation password means "inherit the user's one".
        self.assertIsNone(data["participation_2"]["password"])

    def test_it_refuses_a_password_over_the_bcrypt_limit(self):
        updater = Update28Updater({
            "_version": 27,
            "user_1": {"_class": "User", "password": TOO_LONG_PASSWORD},
        })
        with self.assertRaises(ValueError):
            updater.run()


class TestStressTestPasswords(DatabaseMixin, unittest.TestCase):
    """Tests for how the stress test recovers the passwords it needs."""

    def setUp(self):
        super().setUp()
        # A fresh contest and username per test: the rows are not wiped between
        # tests, and the harvester must not see another test's accounts.
        self.username = "stress" + unique_unicode_id()
        self.contest = self.add_contest()
        self.user = self.add_user(
            username=self.username, password=hash_password(RAW_PASSWORD))
        self.add_participation(contest=self.contest, user=self.user)
        self.session.commit()

    def test_it_uses_the_raw_password_from_the_fixture(self):
        users, _ = StressTest.harvest_contest_data(
            self.contest.id, {self.username: RAW_PASSWORD})
        self.assertEqual(users, {self.username: {"password": RAW_PASSWORD}})

    def test_it_reports_accounts_it_cannot_log_in_as(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            users, _ = StressTest.harvest_contest_data(self.contest.id)
        # A bcrypt row holds no recoverable secret: no account must be claimed
        # as usable, and the skip has to be said out loud, or the harness would
        # report a run that tested nothing.
        self.assertEqual(users, {})
        self.assertIn("--passwords-file", stderr.getvalue())
        self.assertIn(self.username, stderr.getvalue())

    def test_a_plaintext_row_is_not_treated_as_usable(self):
        with SessionGen() as session:
            user = session.query(User) \
                .filter(User.username == self.username).one()
            user.password = "plaintext:" + RAW_PASSWORD
            session.commit()
        stderr = open(os.devnull, "w")
        self.addCleanup(stderr.close)
        with redirect_stderr(stderr):
            users, _ = StressTest.harvest_contest_data(self.contest.id)
        self.assertEqual(users, {})

    def test_the_passwords_file_maps_usernames_to_raw_passwords(self):
        with tempfile.NamedTemporaryFile(
                "wt", suffix=".json", delete=False,
                encoding="utf-8") as file_:
            file_.write('{"%s": "%s"}' % (self.username, RAW_PASSWORD))
            path = file_.name
        self.addCleanup(os.unlink, path)
        self.assertEqual(StressTest.load_passwords_file(path),
                         {self.username: RAW_PASSWORD})

    def test_the_passwords_file_must_be_a_json_object(self):
        with tempfile.NamedTemporaryFile(
                "wt", suffix=".json", delete=False,
                encoding="utf-8") as file_:
            file_.write('["%s"]' % self.username)
            path = file_.name
        self.addCleanup(os.unlink, path)
        with self.assertRaises(SystemExit):
            StressTest.load_passwords_file(path)


if __name__ == "__main__":
    unittest.main()
