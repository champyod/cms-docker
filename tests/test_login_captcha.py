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
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Adaptive login CAPTCHA for AWS and CWS.

Usage: python3 tests/test_login_captcha.py
"""

import importlib.util
import os
import sys
import types
import unittest


REPO_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC_ROOT = os.path.join(REPO_ROOT, "src")

# Order matters: conf.py reads sys.prefix to locate the installation root before it
# parses anything, so the prefix has to be corrected before sys.path is extended.
if sys.prefix == "/usr":
    sys.prefix = REPO_ROOT
os.environ.setdefault("CMS_CONFIG", os.path.join(REPO_ROOT, "config", "cms.toml"))
sys.path.insert(0, SRC_ROOT)


def _load(module_name, relative_path):
    """Load one module straight from the source tree.

    `import cms` runs the package __init__, which reaches cms.db and so needs
    sqlalchemy and the rest of the runtime. Captcha needs neither, only
    dataclasses, so loading its two files directly keeps the tested code real
    and the server's dependencies out of the suite.
    """
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(SRC_ROOT, relative_path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


_package = types.ModuleType("cms")
_package.__path__ = [SRC_ROOT]
sys.modules["cms"] = _package

_server = types.ModuleType("cms.server")
_server.__path__ = [os.path.join(SRC_ROOT, "cms", "server")]
sys.modules["cms.server"] = _server

# conf.py imports cms.log, which in turn reaches the whole runtime. Only set_detailed_logs
# is used, so a placeholder satisfies it without pulling any of that in.
_log = types.ModuleType("cms.log")
_log.set_detailed_logs = lambda *_args, **_kwargs: None
sys.modules["cms.log"] = _log

conf = _load("cms.conf", "cms/conf.py")
_load("cms.server.captcha_provider", "cms/server/captcha_provider.py")
_load("cms.server.login_counters", "cms/server/login_counters.py")
captcha = _load("cms.server.captcha", "cms/server/captcha.py")

REMOTE_IP = "203.0.113.7"


def configured(verify=None, **overrides):
    """A captcha that is on and fully keyed, with the provider stubbed out."""
    values = {
        "enabled": True,
        "provider": "turnstile",
        "site_key": "site-key",
        "secret_key": "secret",
        "threshold": 3,
        "ban_threshold": 5,
    }
    values.update(overrides)
    return captcha.Captcha(conf.CaptchaConfig(**values),
                           verify=verify if verify is not None else (lambda *_: True))


class CaptchaNotDemandedTest(unittest.TestCase):
    def test_below_threshold_needs_no_token(self):
        subject = configured()
        subject.record_failure("admin", REMOTE_IP)
        self.assertFalse(subject.is_required("admin", REMOTE_IP))
        self.assertTrue(subject.verify("admin", REMOTE_IP, ""))

    def test_threshold_demands_a_token(self):
        subject = configured()
        for _ in range(3):
            subject.record_failure("admin", REMOTE_IP)
        self.assertTrue(subject.is_required("admin", REMOTE_IP))

    def test_a_rejected_token_stops_the_attempt(self):
        subject = configured(verify=lambda *_: False)
        for _ in range(3):
            subject.record_failure("admin", REMOTE_IP)
        self.assertFalse(subject.verify("admin", REMOTE_IP, "forged"))

    def test_an_accepted_token_lets_the_attempt_through(self):
        subject = configured()
        for _ in range(3):
            subject.record_failure("admin", REMOTE_IP)
        self.assertTrue(subject.verify("admin", REMOTE_IP, "good"))

    def test_a_demand_from_the_address_reaches_every_account_on_it(self):
        # The address counter is what stops username rotation, so a failure against one
        # account is deliberately enough to demand a captcha from the next one.
        subject = configured()
        for _ in range(3):
            subject.record_failure("admin", REMOTE_IP)
        self.assertTrue(subject.is_required("someone-else", REMOTE_IP))


class UnconfiguredTest(unittest.TestCase):
    def test_disabled_captcha_never_blocks(self):
        subject = configured(enabled=False)
        for _ in range(9):
            subject.record_failure("admin", REMOTE_IP)
        self.assertFalse(subject.is_required("admin", REMOTE_IP))
        self.assertTrue(subject.verify("admin", REMOTE_IP, ""))

    def test_a_missing_secret_never_blocks(self):
        for missing in ("site_key", "secret_key"):
            with self.subTest(missing=missing):
                subject = configured(**{missing: ""})
                self.assertFalse(subject.is_enabled())
                self.assertTrue(subject.verify("admin", REMOTE_IP, ""))

    def test_no_widget_is_rendered_when_unconfigured(self):
        self.assertEqual(configured(enabled=False).widget_html(), "")

    def test_the_secret_is_never_handed_to_a_template(self):
        params = configured().render_params("admin", REMOTE_IP)
        self.assertNotIn("secret_key", params)
        self.assertEqual(params["captcha_site_key"], "site-key")


class EscalationTest(unittest.TestCase):
    def test_a_successful_login_clears_the_counter(self):
        subject = configured()
        for _ in range(3):
            subject.record_failure("admin", REMOTE_IP)
        subject.record_success("admin", REMOTE_IP)
        self.assertFalse(subject.is_required("admin", REMOTE_IP))

    def test_rotating_usernames_still_escalates_the_address(self):
        subject = configured()
        for index in range(3):
            subject.record_failure(f"user-{index}", REMOTE_IP)
        self.assertTrue(subject.is_required("user-0", REMOTE_IP))

    def test_a_loopback_client_is_counted_by_account_but_not_by_address(self):
        # A local address is one attacker, not a shared network, so it holds no
        # address counter — but its failures still count against the account, or a
        # brute force run from the box itself would never escalate.
        counters = captcha.LoginFailureCounters()
        for _ in range(3):
            counters.record_failure("admin", "127.0.0.1")
        self.assertEqual(counters.count("admin", "127.0.0.1"), 3)
        self.assertEqual(counters.count("other", "127.0.0.1"), 0)

    def test_past_the_ban_threshold_the_counter_restarts(self):
        subject = configured(ban_threshold=5)
        for _ in range(5):
            subject.record_failure("admin", REMOTE_IP)
        self.assertFalse(subject.is_required("admin", REMOTE_IP))


class Form:
    """The one method extract_token needs from a request."""

    def __init__(self, values):
        self.values = values

    def get_argument(self, name, default=""):
        return self.values.get(name, default)


class TokenFieldTest(unittest.TestCase):
    def test_the_plain_field_is_read(self):
        self.assertEqual(captcha.extract_token(Form({"captchaToken": "t"})), "t")

    def test_each_provider_field_is_read(self):
        for field in ("cf-turnstile-response", "h-captcha-response",
                      "g-recaptcha-response"):
            with self.subTest(field=field):
                self.assertEqual(captcha.extract_token(Form({field: "t"})), "t")

    def test_a_blank_field_does_not_count_as_a_token(self):
        self.assertEqual(captcha.extract_token(Form({"captchaToken": "   "})), "")


class VerifyTokenTest(unittest.TestCase):
    def test_an_empty_token_is_refused_without_a_request(self):
        self.assertFalse(captcha.verify_token("", "secret", conf.CaptchaConfig()))

    def test_an_unreachable_provider_is_refused(self):
        # Fail closed: a provider that cannot be reached must not become a way
        # past the captcha, and must not raise into the login handler either.
        self.assertFalse(
            captcha.verify_token("t", "s", conf.CaptchaConfig(provider="turnstile")))


if __name__ == "__main__":
    unittest.main(verbosity=2)