#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026 Champ <noreply@example.invalid>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.

"""The parity harness's test, and its negative controls.

Every case here is one the harness has to get right before its zero means
anything: a real change must fail, a per-run value must not, and a request list
that stopped covering a surface must be refused rather than silently shortened.

Docker is not involved: the capture format is a document, so the diff engine is
exercised directly, and the request list is asserted against the surfaces the
slice brief names.

Usage: python3 tests/test_render_parity.py
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PARITY = os.path.join(REPO_ROOT, "scripts", "parity", "parity.py")
REQUESTS = os.path.join(REPO_ROOT, "scripts", "parity", "requests.json")

SURFACES_THE_BRIEF_NAMES = (
    "contest-landing",
    "task-list",
    "submission-list",
    "login",
    "permission-denied",
)


def load_parity():
    spec = importlib.util.spec_from_file_location("cms_parity", PARITY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def entry(request_id, surface="contest-landing", stack="cws", status=200, body="<h1>Overview</h1>",
          location=None, cookies=("_xsrf",)):
    return {
        "id": request_id,
        "surface": surface,
        "stack": stack,
        "method": "GET",
        "path": "/",
        "status": status,
        "headers": {
            "content-type": "text/html; charset=UTF-8",
            "location": location,
            "content-language": "en",
            "cache-control": None,
        },
        "cookies": list(cookies),
        "body_len": len(body),
        "body": body,
    }


class ParityCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parity = load_parity()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def capture(self, name, entries):
        directory = os.path.join(self.tmp.name, name)
        os.makedirs(directory)
        with open(os.path.join(directory, "capture.json"), "w", encoding="utf-8") as handle:
            json.dump({"stack": name, "bases": {}, "requests": entries}, handle)
        return directory

    def diff(self, left, right, json_path=None):
        argv = ["diff", "--a", left, "--b", right]
        if json_path:
            argv += ["--json", json_path]
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            status = self.parity.main(argv)
        return status, out.getvalue()


class AgreesOnTheSameTree(ParityCase):
    def test_identical_captures_report_zero_and_exit_zero(self):
        left = self.capture("a", [entry("one"), entry("two")])
        right = self.capture("b", [entry("one"), entry("two")])
        status, output = self.diff(left, right)
        self.assertEqual(status, 0, output)
        self.assertIn("diff=0", output)

    def test_the_report_says_how_many_it_compared(self):
        left = self.capture("a", [entry("one"), entry("two")])
        right = self.capture("b", [entry("one"), entry("two")])
        report = os.path.join(self.tmp.name, "diff.json")
        status, output = self.diff(left, right, report)
        self.assertEqual(status, 0, output)
        self.assertIn("compared=2", output)
        with open(report, encoding="utf-8") as handle:
            document = json.load(handle)
        self.assertEqual(document["compared"], 2)
        self.assertEqual(document["diff"], 0)

    def test_a_header_the_harness_does_not_compare_is_ignored(self):
        left = self.capture("a", [entry("one")])
        changed = entry("one")
        changed["headers"]["date"] = "Sat, 21 Nov 2026 18:00:00 GMT"
        changed["headers"]["server"] = "TornadoServer/4.5.3"
        right = self.capture("b", [changed])
        status, output = self.diff(left, right)
        self.assertEqual(status, 0, output)


class PerRunValuesAreNormalised(ParityCase):
    def test_csrf_token_epoch_clock_and_datetime_do_not_count(self):
        left_body = ('<input name="_xsrf" value="2|aaaa|bbbb|1795285510">'
                     'utils = new CMS.AWSUtils(".", 1795285510.94982, 0);'
                     'last login 2026-11-21 18:23:19.904638')
        right_body = ('<input name="_xsrf" value="2|cccc|dddd|1795285517">'
                      'utils = new CMS.AWSUtils(".", 1795285517.604691, 0);'
                      'last login 2026-11-21 18:24:44.112233')
        left = self.capture("a", [entry("one", body=left_body)])
        right = self.capture("b", [entry("one", body=right_body)])
        status, output = self.diff(left, right)
        self.assertEqual(status, 0, output)

    def test_session_cookie_value_does_not_count(self):
        left_body = '<script>document.cookie = "awslogin=2|1:0|10:1795284988|56:eyJpZCI6";</script>'
        right_body = '<script>document.cookie = "awslogin=2|1:0|10:1795285521|56:eyJpZCI6";</script>'
        left = self.capture("a", [entry("one", body=left_body)])
        right = self.capture("b", [entry("one", body=right_body)])
        status, output = self.diff(left, right)
        self.assertEqual(status, 0, output)

    def test_every_rule_states_the_observation_that_justifies_it(self):
        for name, _pattern, _replacement, why in self.parity.NORMALISERS:
            self.assertTrue(why.strip(), "normaliser %s has no reason" % name)


class FailsOnAPlantedChange(ParityCase):
    def test_one_changed_word_in_the_body_is_one_diff(self):
        left = self.capture("a", [entry("one", body="<h1>Overview</h1>")])
        right = self.capture("b", [entry("one", body="<h1>Contest Overview</h1>")])
        status, output = self.diff(left, right)
        self.assertEqual(status, 1, output)
        self.assertIn("diff=1", output)
        self.assertIn("DIFF one [body]", output)

    def test_a_changed_status_code_is_a_diff(self):
        left = self.capture("a", [entry("one", status=200)])
        right = self.capture("b", [entry("one", status=403)])
        status, output = self.diff(left, right)
        self.assertEqual(status, 1, output)
        self.assertIn("status=1", output)

    def test_a_changed_redirect_target_is_a_diff(self):
        left = self.capture("a", [entry("one", status=302, location="./login?next=%2F")])
        right = self.capture("b", [entry("one", status=302, location="./login?next=%2Ftasks")])
        status, output = self.diff(left, right)
        self.assertEqual(status, 1, output)
        self.assertIn("headers=1", output)

    def test_a_dropped_surface_is_a_diff(self):
        left = self.capture("a", [entry("one"), entry("two")])
        right = self.capture("b", [entry("one")])
        status, output = self.diff(left, right)
        self.assertEqual(status, 1, output)

    def test_an_extra_surface_is_a_diff(self):
        left = self.capture("a", [entry("one")])
        right = self.capture("b", [entry("one"), entry("two")])
        status, output = self.diff(left, right)
        self.assertEqual(status, 1, output)

    def test_two_error_pages_are_not_equivalence(self):
        left = self.capture("a", [])
        right = self.capture("b", [])
        status, output = self.diff(left, right)
        self.assertEqual(status, 3, output)


class RefusesToCompareAnErrorPage(ParityCase):
    def test_a_500_is_an_expectation_failure(self):
        failures = self.parity.check_expectations(
            {"expect": {"status": 200}}, 500, {}, "boom")
        self.assertTrue(any("500" in failure for failure in failures), failures)

    def test_a_stack_trace_is_an_expectation_failure(self):
        failures = self.parity.check_expectations(
            {"expect": {"status": 200}}, 200, {},
            "Traceback (most recent call last):\n  File x")
        self.assertTrue(any("Traceback" in failure for failure in failures), failures)

    def test_a_clean_response_passes(self):
        failures = self.parity.check_expectations(
            {"expect": {"status": 200, "body_contains": ["Overview"]}}, 200, {},
            "<h1>Overview</h1>")
        self.assertEqual(failures, [])


class RequestListCoversTheSurfaces(ParityCase):
    def setUp(self):
        super().setUp()
        with open(REQUESTS, encoding="utf-8") as handle:
            self.spec = json.load(handle)

    def test_every_surface_the_brief_names_is_requested(self):
        covered = {item["surface"] for item in self.spec["requests"]}
        for surface in SURFACES_THE_BRIEF_NAMES:
            self.assertIn(surface, covered)

    def test_an_admin_surface_and_a_cws_surface_are_both_requested(self):
        stacks = {item["stack"] for item in self.spec["requests"]}
        self.assertEqual(stacks, {"cws", "aws"})
        self.assertTrue(any(item["surface"].startswith("admin-task-list")
                            for item in self.spec["requests"]))

    def test_every_request_says_what_it_must_answer(self):
        for item in self.spec["requests"]:
            expect = item.get("expect") or {}
            self.assertIn("status", expect, "%s has no expected status" % item["id"])

    def test_each_stack_logs_in_before_its_authenticated_requests(self):
        seen_login = {}
        authenticated_after_login = 0
        for item in self.spec["requests"]:
            stack = item["stack"]
            if "login" in item:
                seen_login[stack] = True
                continue
            if item["expect"]["status"] == 200 and seen_login.get(stack):
                authenticated_after_login += 1
        self.assertTrue(seen_login.get("cws"), "no participant login in the list")
        self.assertTrue(seen_login.get("aws"), "no admin login in the list")
        self.assertGreater(authenticated_after_login, 5,
                           "too few authenticated responses to be a participant surface")

    def test_a_permission_denied_response_is_expected_to_be_denied(self):
        denied = [item for item in self.spec["requests"]
                  if item["surface"] == "permission-denied"]
        self.assertTrue(denied)
        for item in denied:
            self.assertIn(item["expect"]["status"], (401, 403), item["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
