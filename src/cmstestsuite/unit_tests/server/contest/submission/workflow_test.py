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

import unittest
from collections import namedtuple
from datetime import timedelta
from unittest.mock import MagicMock, PropertyMock, patch, sentinel, ANY

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin

from cms import config
from cms.db import Submission, UserTest
from cms.server.contest.submission import InvalidArchive, \
    InvalidFilesOrLanguage, StorageFailed, UnacceptableSubmission, \
    accept_submission, TestingNotAllowed, UnacceptableUserTest, accept_user_test
from cmscommon.datetime import make_datetime
from cmscommon.digest import bytes_digest
from cmstestsuite.unit_tests.testidgenerator import unique_long_id, \
    unique_unicode_id


MockHTTPFile = namedtuple("MockHTTPFile", ["filename", "body"])


def make_language(name, source_extensions):
    language = MagicMock()
    language.configure_mock(name=name,
                            source_extensions=source_extensions,
                            source_extension=source_extensions[0])
    return language


FOO_CONTENT = b"this is the content of a file"
BAR_CONTENT = b"this is the content of another file"
BAZ_CONTENT = b"this is the content of a third file"
SPAM_CONTENT = b"this is the content of a fourth file"
HAM_CONTENT = b"this is the content of a fifth file"
EGGS_CONTENT = b"this is the content of a sixth file"
INPUT_CONTENT = b"this is the content of an input file"


class TestAcceptSubmission(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()

        # Set up patches and mocks for a successful run. These are all
        # controlled by the following values, which can be changed to
        # make some steps fail. The task will require a language-aware
        # submission with three files: foo.%l, bar.%l and baz.%l; the
        # first will be provided by the contestant, the second will be
        # fetched from the previous submission (as partial submissions
        # will be allowed), the third will be missing.

        self.contest = self.add_contest(
            languages=["MockLanguage", "AnotherMockLanguage"])
        self.participation = self.add_participation(
            contest=self.contest)
        self.task = self.add_task(
            submission_format=["foo.%l", "bar.%l", "baz.%l"],
            contest=self.contest)
        self.dataset = self.add_dataset(
            task=self.task)
        self.task.active_dataset = self.dataset

        self.timestamp = make_datetime()
        self.tornado_files = sentinel.tornado_files
        self.language_name = sentinel.language_name
        self.official = True
        self.received_files = []
        self.files = {"foo.%l": FOO_CONTENT}
        # Multiple extensions, primary one doesn't start with a period.
        self.language = make_language("MockLanguage", ["mock.1", ".mock2"])
        self.digests = {"bar.%l": bytes_digest(BAR_CONTENT)}
        self.submit_local_copy_path = unique_unicode_id()

        patcher = patch('cms.db.Dataset.task_type_object',
                        new_callable=PropertyMock)
        self.task_type = patcher.start().return_value
        self.addCleanup(patcher.stop)
        self.task_type.ALLOW_PARTIAL_SUBMISSION = True

        patcher = patch(
            "cms.server.contest.submission.workflow.check_max_number")
        self.check_max_number = patcher.start()
        self.addCleanup(patcher.stop)
        self.check_max_number.return_value = True

        patcher = patch(
            "cms.server.contest.submission.workflow.check_min_interval")
        self.check_min_interval = patcher.start()
        self.addCleanup(patcher.stop)
        self.check_min_interval.return_value = True

        patcher = patch(
            "cms.server.contest.submission.workflow.is_last_minutes")
        self.is_last_minutes = patcher.start()
        self.addCleanup(patcher.stop)
        self.is_last_minutes.return_value = False

        patcher = patch(
            "cms.server.contest.submission.workflow.extract_files_from_tornado")
        self.extract_files_from_tornado = patcher.start()
        self.addCleanup(patcher.stop)
        self.extract_files_from_tornado.return_value = self.received_files

        patcher = patch(
            "cms.server.contest.submission.workflow.match_files_and_language")
        self.match_files_and_language = patcher.start()
        self.addCleanup(patcher.stop)
        # Use side_effect to keep it working if we reassign the values.
        self.match_files_and_language.side_effect = \
            lambda *args, **kwargs: (self.files, self.language)

        patcher = patch(
            "cms.server.contest.submission.workflow"
            ".fetch_file_digests_from_previous_submission")
        self.fetch_file_digests_from_previous_submission = patcher.start()
        self.addCleanup(patcher.stop)
        # Use side_effect to keep it working if we reassign the value.
        self.fetch_file_digests_from_previous_submission.side_effect = \
            lambda *args, **kwargs: self.digests

        patcher = patch.object(config.contest_web_server, "submit_local_copy", True)
        patcher.start()
        self.addCleanup(patcher.stop)

        patcher = patch.object(
            config.contest_web_server,
            "submit_local_copy_path",
            self.submit_local_copy_path,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

        patcher = patch(
            "cms.server.contest.submission.workflow.store_local_copy")
        self.store_local_copy = patcher.start()
        self.addCleanup(patcher.stop)

        self.file_cacher = MagicMock()
        self.file_cacher.put_file_content.side_effect = \
            lambda content, _: bytes_digest(content)

    def call(self):
        return accept_submission(
            self.session, self.file_cacher, self.participation, self.task,
            self.timestamp, self.tornado_files, self.language_name,
            self.official)

    def assertSubmissionIsValid(self, submission, timestamp, language, files,
                                official):
        # Ensure pending submissions are sent to the DB and given IDs.
        self.session.flush()

        # Ensure the submission is in the DB.
        db_submission = self.session.query(Submission) \
            .filter(Submission.id == submission.id).first()
        self.assertIs(submission, db_submission)

        # And that it has the expected fields.
        self.assertEqual(submission.timestamp, timestamp)
        self.assertEqual(submission.language, language)
        self.assertCountEqual(submission.files.keys(), files.keys())
        self.assertCountEqual((f.digest for f in submission.files.values()),
                              (bytes_digest(b) for b in files.values()))
        self.assertIs(submission.official, official)

    def test_it_accepts_a_valid_submission(self):
        submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT}, True)

    def test_it_accepts_a_submission_when_all_languages_are_allowed(self):
        self.contest.languages = None

        submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT}, True)

    def test_it_accepts_a_language_agnostic_submission(self):
        self.task.submission_format = ["foo", "bar", "baz"]
        self.files = {"foo": FOO_CONTENT}
        self.language = None
        self.digests = {"bar": bytes_digest(BAR_CONTENT)}

        submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, None,
            {"foo": FOO_CONTENT, "bar": BAR_CONTENT}, True)

    def test_it_accepts_an_unofficial_submission(self):
        self.official = False

        submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT}, False)

    def test_it_rejects_a_submission_over_the_contest_limit(self):
        max_number = unique_long_id()
        self.contest.max_submission_number = max_number
        # False only when we ask for contest.
        self.check_max_number.side_effect = \
            lambda *args, **kwargs: "contest" not in kwargs

        with self.assertRaisesRegex(UnacceptableSubmission, "%d" % max_number):
            self.call()

        self.check_max_number.assert_called_with(
            self.session, max_number, self.participation, contest=self.contest)

    def test_it_rejects_a_submission_over_the_task_limit(self):
        max_number = unique_long_id()
        self.task.max_submission_number = max_number
        # False only when we ask for task.
        self.check_max_number.side_effect = \
            lambda *args, **kwargs: "task" not in kwargs

        with self.assertRaisesRegex(UnacceptableSubmission, "%d" % max_number):
            self.call()

        self.check_max_number.assert_called_with(
            self.session, max_number, self.participation, task=self.task)

    def test_it_rejects_a_submission_before_the_contest_interval(self):
        min_interval = timedelta(seconds=unique_long_id())
        self.contest.min_submission_interval = min_interval
        # False only when we ask for contest.
        self.check_min_interval.side_effect = \
            lambda *args, **kwargs: "contest" not in kwargs

        with self.assertRaisesRegex(UnacceptableSubmission,
                                    "%d" % min_interval.total_seconds()):
            self.call()

        self.check_min_interval.assert_called_with(
            self.session, min_interval, self.timestamp, self.participation,
            contest=self.contest)

    def test_it_accepts_a_submission_in_the_grace_period_of_the_contest(self):
        min_interval = timedelta(seconds=unique_long_id())
        self.contest.min_submission_interval = min_interval
        # False only when we ask for contest.
        self.check_min_interval.side_effect = \
            lambda *args, **kwargs: "contest" not in kwargs
        self.is_last_minutes.return_value = True

        self.call()

        self.is_last_minutes.assert_called_with(
            self.timestamp, self.participation)

    def test_it_rejects_a_submission_before_the_task_interval(self):
        min_interval = timedelta(seconds=unique_long_id())
        self.task.min_submission_interval = min_interval
        # False only when we ask for task.
        self.check_min_interval.side_effect = \
            lambda *args, **kwargs: "task" not in kwargs

        with self.assertRaisesRegex(UnacceptableSubmission,
                                    "%d" % min_interval.total_seconds()):
            self.call()

        self.check_min_interval.assert_called_with(
            self.session, min_interval, self.timestamp, self.participation,
            task=self.task)

    def test_it_accepts_a_submission_in_the_grace_period_of_the_task(self):
        min_interval = timedelta(seconds=unique_long_id())
        self.task.min_submission_interval = min_interval
        # False only when we ask for task.
        self.check_min_interval.side_effect = \
            lambda *args, **kwargs: "task" not in kwargs
        self.is_last_minutes.return_value = True

        self.call()

        self.is_last_minutes.assert_called_with(
            self.timestamp, self.participation)

    def test_it_rejects_an_invalid_archive(self):
        self.extract_files_from_tornado.side_effect = InvalidArchive

        with self.assertRaisesRegex(UnacceptableSubmission, "archive"):
            self.call()

        self.extract_files_from_tornado.assert_called_with(self.tornado_files, ANY, ANY)

    def test_it_rejects_files_that_do_not_match(self):
        self.match_files_and_language.side_effect = InvalidFilesOrLanguage

        with self.assertRaisesRegex(UnacceptableSubmission, "file"):
            self.call()

        self.match_files_and_language.assert_called_with(
            self.received_files, self.language_name,
            {"foo.%l", "bar.%l", "baz.%l"},
            ["MockLanguage", "AnotherMockLanguage"])

    def test_it_rejects_a_partial_submission_when_partials_are_disallowed(self):
        self.task_type.ALLOW_PARTIAL_SUBMISSION = False

        with self.assertRaisesRegex(UnacceptableSubmission, "file"):
            self.call()

        self.fetch_file_digests_from_previous_submission.assert_not_called()

    def test_it_accepts_a_complete_submission_when_partials_are_disallowed(self):
        self.task_type.ALLOW_PARTIAL_SUBMISSION = False
        # Ensure all codenames of the submission format are provided.
        self.files["bar.%l"] = BAR_CONTENT
        self.files["baz.%l"] = BAZ_CONTENT

        submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT,
             "baz.%l": BAZ_CONTENT}, True)
        self.fetch_file_digests_from_previous_submission.assert_not_called()

    def test_it_rejects_files_over_the_maximum_length(self):
        self.files["foo.%l"] = FOO_CONTENT * 100
        max_size = len(FOO_CONTENT) * 100 - 1

        with patch.object(config.contest_web_server, "max_submission_length", max_size):
            with self.assertRaisesRegex(UnacceptableSubmission,
                                        "%d" % max_size):
                self.call()

    def test_it_accepts_a_submission_without_storing_a_local_copy(self):
        with patch.object(config.contest_web_server, "submit_local_copy", False):
            submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT}, True)
        self.store_local_copy.assert_not_called()

    def test_it_accepts_a_submission_even_when_storing_the_copy_fails(self):
        self.store_local_copy.side_effect = StorageFailed

        submission = self.call()

        self.assertSubmissionIsValid(
            submission, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT}, True)
        self.store_local_copy.assert_called_with(
            self.submit_local_copy_path, self.participation, self.task,
            self.timestamp, self.files)

    def test_it_rejects_a_submission_when_storage_fails(self):
        self.file_cacher.put_file_content.side_effect = Exception

        with self.assertRaisesRegex(UnacceptableSubmission, "storage"):
            self.call()

        args, kwargs = self.file_cacher.put_file_content.call_args
        self.assertEqual(kwargs, dict())
        self.assertEqual(len(args), 2)
        content, description = args
        self.assertEqual(content, FOO_CONTENT)
        self.assertIn("foo.%l", description)
        self.assertIn(self.participation.user.username, description)


class TestAcceptUserTest(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()

        # Set up patches and mocks for a successful run. These are all
        # controlled by the following values, which can be changed to
        # make some steps fail. The task will require a language-aware
        # submission with three files (foo.%l, bar.%l and baz.%l), three
        # managers (spam.%l, ham.%l, eggs.%l) and an input. For both the
        # files and the managers, the first will be provided by the
        # contestant, the second will be fetched from the previous
        # submission (as partial submissions will be allowed), the third
        # will be missing. The input will be provided by the contestant.

        self.contest = self.add_contest(
            languages=["MockLanguage", "AnotherMockLanguage"])
        self.participation = self.add_participation(
            contest=self.contest)
        self.task = self.add_task(
            submission_format=["foo.%l", "bar.%l", "baz.%l"],
            contest=self.contest)
        self.dataset = self.add_dataset(
            task=self.task)
        self.task.active_dataset = self.dataset

        self.timestamp = make_datetime()
        self.tornado_files = sentinel.tornado_files
        self.language_name = sentinel.language_name
        self.received_files = sentinel.received_files
        self.files = {"foo.%l": FOO_CONTENT,
                      "spam.%l": SPAM_CONTENT,
                      "input": INPUT_CONTENT}
        # Multiple extensions, primary one doesn't start with a period.
        self.language = make_language("MockLanguage", ["mock.1", ".mock2"])
        self.digests = {"bar.%l": bytes_digest(BAR_CONTENT),
                        "ham.%l": bytes_digest(HAM_CONTENT)}
        self.tests_local_copy_path = unique_unicode_id()

        patcher = patch('cms.db.Dataset.task_type_object',
                        new_callable=PropertyMock)
        self.task_type = patcher.start().return_value
        self.addCleanup(patcher.stop)
        self.task_type.ALLOW_PARTIAL_SUBMISSION = True
        self.task_type.testable = True
        self.task_type.get_user_managers.return_value = \
            ["spam.%l", "ham.%l", "eggs.%l"]

        patcher = patch(
            "cms.server.contest.submission.workflow.check_max_number")
        self.check_max_number = patcher.start()
        self.addCleanup(patcher.stop)
        self.check_max_number.return_value = True

        patcher = patch(
            "cms.server.contest.submission.workflow.check_min_interval")
        self.check_min_interval = patcher.start()
        self.addCleanup(patcher.stop)
        self.check_min_interval.return_value = True

        patcher = patch(
            "cms.server.contest.submission.workflow.extract_files_from_tornado")
        self.extract_files_from_tornado = patcher.start()
        self.addCleanup(patcher.stop)
        self.extract_files_from_tornado.return_value = self.received_files

        patcher = patch(
            "cms.server.contest.submission.workflow.match_files_and_language")
        self.match_files_and_language = patcher.start()
        self.addCleanup(patcher.stop)
        # Use side_effect to keep it working if we reassign the values.
        self.match_files_and_language.side_effect = \
            lambda *args, **kwargs: (self.files, self.language)

        patcher = patch(
            "cms.server.contest.submission.workflow"
            ".fetch_file_digests_from_previous_submission")
        self.fetch_file_digests_from_previous_submission = patcher.start()
        self.addCleanup(patcher.stop)
        # Use side_effect to keep it working if we reassign the value.
        self.fetch_file_digests_from_previous_submission.side_effect = \
            lambda *args, **kwargs: self.digests

        patcher = patch.object(config.contest_web_server, "tests_local_copy", True)
        patcher.start()
        self.addCleanup(patcher.stop)

        patcher = patch.object(
            config.contest_web_server,
            "tests_local_copy_path",
            self.tests_local_copy_path,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

        patcher = patch(
            "cms.server.contest.submission.workflow.store_local_copy")
        self.store_local_copy = patcher.start()
        self.addCleanup(patcher.stop)

        self.file_cacher = MagicMock()
        self.file_cacher.put_file_content.side_effect = \
            lambda content, _: bytes_digest(content)

    def call(self):
        return accept_user_test(
            self.session, self.file_cacher, self.participation, self.task,
            self.timestamp, self.tornado_files, self.language_name)

    def assertUserTestIsValid(self, user_test, timestamp, language, files,
                              managers, input_):
        # Ensure pending user tests are sent to the DB and given IDs.
        self.session.flush()

        # Ensure the user test is in the DB.
        db_user_test = self.session.query(UserTest) \
            .filter(UserTest.id == user_test.id).first()
        self.assertIs(user_test, db_user_test)

        # And that it has the expected fields.
        self.assertEqual(user_test.timestamp, timestamp)
        self.assertEqual(user_test.language, language)
        self.assertCountEqual(user_test.files.keys(), files.keys())
        self.assertCountEqual((f.digest for f in user_test.files.values()),
                              (bytes_digest(b) for b in files.values()))
        self.assertCountEqual(user_test.managers.keys(), managers.keys())
        self.assertCountEqual((f.digest for f in user_test.managers.values()),
                              (bytes_digest(b) for b in managers.values()))
        self.assertEqual(user_test.input,
                         bytes_digest(input_) if input_ is not None else None)

    def test_it_accepts_a_valid_user_test(self):
        user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT},
            {"spammock.1": SPAM_CONTENT, "hammock.1": HAM_CONTENT},
            INPUT_CONTENT)

    def test_it_accepts_a_user_test_when_all_languages_are_allowed(self):
        self.contest.languages = None

        user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT},
            {"spammock.1": SPAM_CONTENT, "hammock.1": HAM_CONTENT},
            INPUT_CONTENT)

    def test_it_accepts_a_language_agnostic_user_test(self):
        self.task.submission_format = ["foo", "bar", "baz"]
        self.task_type.get_user_managers.return_value = ["spam", "ham", "eggs"]
        self.files = {"foo": FOO_CONTENT, "spam": SPAM_CONTENT,
                      "input": INPUT_CONTENT}
        self.language = None
        self.digests = {"bar": bytes_digest(BAR_CONTENT),
                        "ham": bytes_digest(HAM_CONTENT)}

        user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, None,
            {"foo": FOO_CONTENT, "bar": BAR_CONTENT},
            {"spam": SPAM_CONTENT, "ham": HAM_CONTENT},
            INPUT_CONTENT)

    def test_it_fills_the_input_from_the_previous_user_test(self):
        del self.files["input"]
        self.digests["input"] = bytes_digest(INPUT_CONTENT)

        user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT},
            {"spammock.1": SPAM_CONTENT, "hammock.1": HAM_CONTENT},
            INPUT_CONTENT)

    def test_it_rejects_a_user_test_without_an_input(self):
        del self.files["input"]

        with self.assertRaisesRegex(UnacceptableUserTest, "file"):
            self.call()

    def test_it_rejects_a_user_test_when_testing_is_not_allowed(self):
        self.task_type.testable = False

        with self.assertRaises(TestingNotAllowed):
            self.call()

    def test_it_rejects_a_user_test_over_the_contest_limit(self):
        max_number = unique_long_id()
        self.contest.max_user_test_number = max_number
        # False only when we ask for contest.
        self.check_max_number.side_effect = \
            lambda *args, **kwargs: "contest" not in kwargs

        with self.assertRaisesRegex(UnacceptableUserTest, "%d" % max_number):
            self.call()

        self.check_max_number.assert_called_with(
            self.session, max_number, self.participation, contest=self.contest,
            cls=UserTest)

    def test_it_rejects_a_user_test_over_the_task_limit(self):
        max_number = unique_long_id()
        self.task.max_user_test_number = max_number
        # False only when we ask for task.
        self.check_max_number.side_effect = \
            lambda *args, **kwargs: "task" not in kwargs

        with self.assertRaisesRegex(UnacceptableUserTest, "%d" % max_number):
            self.call()

        self.check_max_number.assert_called_with(
            self.session, max_number, self.participation, task=self.task,
            cls=UserTest)

    def test_it_rejects_a_user_test_before_the_contest_interval(self):
        min_interval = timedelta(seconds=unique_long_id())
        self.contest.min_user_test_interval = min_interval
        # False only when we ask for contest.
        self.check_min_interval.side_effect = \
            lambda *args, **kwargs: "contest" not in kwargs

        with self.assertRaisesRegex(UnacceptableUserTest,
                                    "%d" % min_interval.total_seconds()):
            self.call()

        self.check_min_interval.assert_called_with(
            self.session, min_interval, self.timestamp, self.participation,
            contest=self.contest, cls=UserTest)

    def test_it_rejects_a_user_test_before_the_task_interval(self):
        min_interval = timedelta(seconds=unique_long_id())
        self.task.min_user_test_interval = min_interval
        # False only when we ask for task.
        self.check_min_interval.side_effect = \
            lambda *args, **kwargs: "task" not in kwargs

        with self.assertRaisesRegex(UnacceptableUserTest,
                                    "%d" % min_interval.total_seconds()):
            self.call()

        self.check_min_interval.assert_called_with(
            self.session, min_interval, self.timestamp, self.participation,
            task=self.task, cls=UserTest)

    def test_it_rejects_a_user_test_with_an_invalid_archive(self):
        self.extract_files_from_tornado.side_effect = InvalidArchive

        with self.assertRaisesRegex(UnacceptableUserTest, "archive"):
            self.call()

        self.extract_files_from_tornado.assert_called_with(self.tornado_files, ANY, ANY)

    def test_it_rejects_user_test_files_that_do_not_match(self):
        self.match_files_and_language.side_effect = InvalidFilesOrLanguage

        with self.assertRaisesRegex(UnacceptableUserTest, "file"):
            self.call()

        self.match_files_and_language.assert_called_with(
            self.received_files, self.language_name,
            {"foo.%l", "bar.%l", "baz.%l", "spam.%l", "ham.%l", "eggs.%l",
             "input"},
            ["MockLanguage", "AnotherMockLanguage"])

    def test_it_accepts_a_complete_user_test_when_partials_are_disallowed(self):
        self.task_type.ALLOW_PARTIAL_SUBMISSION = False
        # Ensure all codenames of the submission format are provided.
        self.files["bar.%l"] = BAR_CONTENT
        self.files["baz.%l"] = BAZ_CONTENT
        self.files["ham.%l"] = HAM_CONTENT
        self.files["eggs.%l"] = EGGS_CONTENT

        user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT,
             "baz.%l": BAZ_CONTENT},
            {"spammock.1": SPAM_CONTENT, "hammock.1": HAM_CONTENT,
             "eggsmock.1": EGGS_CONTENT},
            INPUT_CONTENT)
        self.fetch_file_digests_from_previous_submission.assert_not_called()

    def test_it_rejects_a_partial_user_test_when_partials_are_disallowed(self):
        self.task_type.ALLOW_PARTIAL_SUBMISSION = False

        with self.assertRaisesRegex(UnacceptableUserTest, "file"):
            self.call()

        self.fetch_file_digests_from_previous_submission.assert_not_called()

    def test_it_rejects_user_test_files_over_the_maximum_length(self):
        self.files["foo.%l"] = FOO_CONTENT * 100
        max_size = len(FOO_CONTENT) * 100 - 1

        with patch.object(config.contest_web_server, "max_submission_length", max_size):
            with self.assertRaisesRegex(UnacceptableUserTest, "%d" % max_size):
                self.call()

    def test_it_rejects_user_test_managers_over_the_maximum_length(self):
        self.files["spam.%l"] = SPAM_CONTENT * 100
        max_size = len(SPAM_CONTENT) * 100 - 1

        with patch.object(config.contest_web_server, "max_submission_length", max_size):
            with self.assertRaisesRegex(UnacceptableUserTest, "%d" % max_size):
                self.call()

    def test_it_rejects_a_user_test_input_over_the_maximum_length(self):
        self.files["input"] = INPUT_CONTENT * 100
        max_size = len(INPUT_CONTENT) * 100 - 1

        with patch.object(config.contest_web_server, "max_input_length", max_size):
            with self.assertRaisesRegex(UnacceptableUserTest, "%d" % max_size):
                self.call()

    def test_it_accepts_a_user_test_without_storing_a_local_copy(self):
        with patch.object(config.contest_web_server, "tests_local_copy", False):
            user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT},
            {"spammock.1": SPAM_CONTENT, "hammock.1": HAM_CONTENT},
            INPUT_CONTENT)
        self.store_local_copy.assert_not_called()

    def test_it_accepts_a_user_test_even_when_storing_the_copy_fails(self):
        self.store_local_copy.side_effect = StorageFailed

        user_test = self.call()

        self.assertUserTestIsValid(
            user_test, self.timestamp, "MockLanguage",
            {"foo.%l": FOO_CONTENT, "bar.%l": BAR_CONTENT},
            {"spammock.1": SPAM_CONTENT, "hammock.1": HAM_CONTENT},
            INPUT_CONTENT)
        self.store_local_copy.assert_called_with(
            self.tests_local_copy_path, self.participation, self.task,
            self.timestamp, self.files)

    def test_it_rejects_a_user_test_when_storage_fails(self):
        self.file_cacher.put_file_content.side_effect = Exception

        with self.assertRaisesRegex(UnacceptableUserTest, "storage"):
            self.call()

        args, kwargs = self.file_cacher.put_file_content.call_args
        self.assertEqual(kwargs, dict())
        self.assertEqual(len(args), 2)
        content, description = args
        self.assertIn(content, {FOO_CONTENT, SPAM_CONTENT, INPUT_CONTENT})
        self.assertRegex(description, "foo.%l|spammock.1|input")
        self.assertIn(self.participation.user.username, description)


if __name__ == "__main__":
    unittest.main()
