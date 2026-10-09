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
import re
import sys
import tempfile
import types
import unittest

import jinja2


REPO_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC_ROOT = os.path.join(REPO_ROOT, "src")
# The loader the contest web server itself uses, so the pages under test are the
# shipped ones rather than a copy that could drift from them.
TEMPLATES = os.path.join(SRC_ROOT, "cms", "server", "contest", "templates")

# The loader rejects the sample's shipped default secret, so a generated config carries a
# non-default 16-byte hex key.
SUITE_SECRET_KEY: str = "0123456789abcdef0123456789abcdef"


def _config_path() -> str:
    """Return a config the loader accepts: config/cms.toml when present, else the tracked
    sample with a real secret. Only conf.CaptchaConfig is under test."""
    live: str = os.path.join(REPO_ROOT, "config", "cms.toml")
    if os.path.exists(live):
        return live
    with open(os.path.join(REPO_ROOT, "config", "cms.sample.toml"), encoding="utf-8") as source:
        sample: str = source.read()
    sample = re.sub(r'^secret_key = ".*"$', f'secret_key = "{SUITE_SECRET_KEY}"',
                    sample, count=1, flags=re.MULTILINE)
    path: str = os.path.join(tempfile.mkdtemp(prefix="cms-captcha-config-"), "cms.toml")
    with open(path, "w", encoding="utf-8") as generated:
        generated.write(sample)
    return path


# Order matters: conf.py reads sys.prefix to locate the installation root before it
# parses anything, so the prefix has to be corrected before sys.path is extended.
if sys.prefix == "/usr":
    sys.prefix = REPO_ROOT
if "CMS_CONFIG" not in os.environ:
    os.environ["CMS_CONFIG"] = _config_path()
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
backend = _load("cms.server.login_counter_backend",
                "cms/server/login_counter_backend.py")
counters = _load("cms.server.login_counters", "cms/server/login_counters.py")
captcha = _load("cms.server.captcha", "cms/server/captcha.py")

REMOTE_IP = "203.0.113.7"

CONTESTANT = "contestant"
# One failure past the captcha threshold of `configured`, and one short of its
# ban threshold: the count demands a challenge without also locking the account,
# so a refusal can only have come from the captcha gate.
OVER_CAPTCHA_THRESHOLD = 4


def _stub(name, **attributes):
    """Register a placeholder module under *name* and return it.

    WHY the handlers reach so much that this exists: loading api.py imports the
    ORM models and the database session machinery, none of which is installed
    here. Only the login gates are under test, so what they import is replaced
    by placeholders and the file itself is executed unmodified -- the code that
    decides the refusal is the real one.
    """
    module = types.ModuleType(name)
    module.__dict__.update(attributes)
    sys.modules[name] = module
    return module


def _passthrough_decorator(*args, **kwargs):
    """A decorator that changes nothing, in the bare and the called form.

    WHY both forms: the handlers use `@multi_contest` bare and
    `@actual_phase_required(0, 3)` with arguments. A stub written for only one
    of them turns the other into a lambda, so the module still loads while the
    method it wrapped is no longer the real one.
    """
    if len(args) == 1 and not kwargs and callable(args[0]):
        return args[0]
    return lambda function: function


def _load_api_module():
    """Return the real contest API handler module with its imports stubbed."""
    _stub("cms.db", __path__=[os.path.join(SRC_ROOT, "cms", "db")])
    _stub("cms.db.submission", Submission=type("Submission", (), {}))
    _stub("cms.db.user", Participation=type("Participation", (), {}))

    contest_package = os.path.join(SRC_ROOT, "cms", "server", "contest")
    _stub("cms.server.contest", __path__=[contest_package])
    _stub("cms.server.contest.handlers",
          __path__=[os.path.join(contest_package, "handlers")])
    _stub("cms.server.contest.handlers.contest",
          ContestHandler=type("ContestHandler", (), {}),
          api_login_required=_passthrough_decorator)
    _stub("cms.server.contest.phase_management",
          actual_phase_required=_passthrough_decorator)
    _stub("cms.server.contest.authentication", validate_login=_stubbed_login)
    _stub("cms.server.contest.submission",
          UnacceptableSubmission=type("UnacceptableSubmission", (Exception,), {}),
          accept_submission=lambda *_args, **_kwargs: None)

    sys.modules["cms.server"].multi_contest = _passthrough_decorator
    return _load("cms.server.contest.handlers.api",
                 "cms/server/contest/handlers/api.py")


# WHY the stand-in records its calls: an admin token is only ever checked by the
# real validate_login, so the thing that shows a token is not waved through by
# the exemption is that the gate still lets the attempt reach it.
VALIDATED_LOGINS: list = []


def _stubbed_login(*args, **kwargs):
    """The stand-in validate_login: records the attempt and refuses it."""
    VALIDATED_LOGINS.append((args, kwargs))
    return None, None


api = _load_api_module()


class ManualClock:
    """A clock the test moves by hand.

    A failure window is measured in minutes, so asserting that one lapses
    otherwise means either waiting for it or reading a private field and
    rewriting the timestamp behind the code's back. Driving the clock the
    backend already accepts keeps the assertion on the behaviour rather than on
    the storage detail.
    """

    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def configured(verify=None, clock=None, **overrides):
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
    if clock is not None:
        counts = counters.LoginFailureCounters(
            backend=backend.InProcessBackend(clock=clock))
        return captcha.Captcha(conf.CaptchaConfig(**values), counters=counts,
                               verify=verify if verify is not None
                               else (lambda *_: True))
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

    def test_the_ban_threshold_refuses_and_keeps_refusing(self):
        # Reaching the threshold must REFUSE, not reset the count. A count that
        # restarted there re-armed itself on the very next attempt, so the
        # account was guessable without limit: the sixth guess was counted as
        # the first, and so on forever. Every attempt past the threshold has to
        # read as locked, which is only true while the count is retained.
        subject = configured(ban_threshold=5)
        for _ in range(5):
            subject.record_failure("admin", REMOTE_IP)
        self.assertTrue(subject.is_locked("admin", REMOTE_IP))
        for _ in range(3):
            subject.record_failure("admin", REMOTE_IP)
            self.assertTrue(subject.is_locked("admin", REMOTE_IP))

    def test_a_lapsed_window_reads_as_no_failures(self):
        # A count that never expired would strand a user who mistyped a few
        # times, walked away, and came back: their old failures would still be
        # counted against them an hour later.
        clock = ManualClock()
        subject = configured(ban_threshold=5, clock=clock)
        for _ in range(4):
            subject.record_failure("admin", REMOTE_IP)
        self.assertFalse(subject.is_locked("admin", REMOTE_IP))

        clock.advance(counters.FAILURE_WINDOW + 1)
        self.assertEqual(subject.counters.count("admin", REMOTE_IP), 0)
        self.assertFalse(subject.is_locked("admin", REMOTE_IP))

    def test_the_window_slides_so_a_lockout_outlives_the_gap(self):
        # Each failure must push the window forward, or an attacker pausing for
        # most of a window between guesses would regain a fresh allowance every
        # time: four failures spread across three windows still have to add up.
        clock = ManualClock()
        subject = configured(ban_threshold=5, clock=clock)
        for _ in range(4):
            subject.record_failure("admin", REMOTE_IP)
            clock.advance(counters.FAILURE_WINDOW - 1)
        self.assertEqual(subject.counters.count("admin", REMOTE_IP), 4)

        subject.record_failure("admin", REMOTE_IP)
        self.assertTrue(subject.is_locked("admin", REMOTE_IP))

        # Going quiet for less than a window must not lift the lockout.
        clock.advance(counters.FAILURE_WINDOW - 1)
        self.assertTrue(subject.is_locked("admin", REMOTE_IP))


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


class Attributes:
    """A bag of attributes for the names a template reads off an object."""

    def __init__(self, **attributes):
        self.__dict__.update(attributes)


def _render(template_name: str, facts: dict) -> str:
    """Render one contest template the way the contest web server does.

    WHY the templates are rendered here instead of being grepped for the
    widget: the defect was a form served without a challenge it was then
    refused for, so what matters is that the rendered page carries the field
    back to the server. The loader, the i18n extension and StrictUndefined are
    the ones the server itself configures; the context is the smallest set of
    names the login pages read, and the captcha facts are the ones
    ContestHandler.render_params really returns.
    """
    environment = jinja2.Environment(
        trim_blocks=True, lstrip_blocks=True, autoescape=True,
        undefined=jinja2.StrictUndefined,
        loader=jinja2.FileSystemLoader(TEMPLATES),
        extensions=["jinja2.ext.i18n"])
    environment.install_null_translations(newstyle=True)
    # The two filters the pages declare for a logged-in client; the login pages
    # never reach them, but the whole file is compiled at once.
    environment.filters["to_language"] = lambda value: Attributes(
        source_extensions=[])
    environment.filters["make_timestamp"] = lambda value: 0
    return environment.get_template(template_name).render(**facts)


def _login_page_facts(captcha_facts: dict) -> dict:
    """Return a render context for the pages an unauthenticated client reaches."""
    return {
        "url": lambda *_args, **_kwargs: "/static/x",
        "contest_url": lambda *_args, **_kwargs: "/contest",
        "handler": Attributes(get_argument=lambda _name, default="": default),
        "xsrf_form_html": "",
        "translation": Attributes(identifier="en"),
        "contest": Attributes(description="A contest", name="contest",
                              languages=[], tasks=[], allow_registration=True),
        "available_translations": [],
        "credits": Attributes(project=Attributes(name="CMS"),
                              license=Attributes(url="/license", name="AGPL")),
        "config": Attributes(global_=Attributes(source_url="/source")),
        "teams": [],
        "MAX_INPUT_LENGTH": 50,
        "MIN_PASSWORD_LENGTH": 6,
        **captcha_facts,
    }


def _over_threshold() -> "captcha.Captcha":
    """A captcha demanding a challenge, with every answer refused.

    WHY every answer is refused: the pages have to carry a field the client can
    answer, and a stub that accepted anything would make a template that posts
    no field look correct.
    """
    subject = configured(verify=lambda *_args: False)
    for _ in range(OVER_CAPTCHA_THRESHOLD):
        subject.record_failure(CONTESTANT, REMOTE_IP)
    return subject


class ContestFormWidgetTest(unittest.TestCase):
    """The widget the contest login and registration forms have to post back."""

    def test_the_contest_login_form_carries_the_widget(self):
        # contest.html is the base template every other contest page extends, so
        # this is the form an unauthenticated contestant is served on the contest
        # root, and it is refused at main.py's gate when the captcha is demanded.
        subject = _over_threshold()
        page = _render("contest.html", _login_page_facts(
            subject.render_params(CONTESTANT, REMOTE_IP)))

        self.assertIn("captchaToken", page)
        self.assertIn(subject.config.site_key, page)

    def test_the_registration_form_carries_the_widget(self):
        # The registration handler refuses a challenged attempt with a 429 and
        # its own script shows the widget again, so the form has to post the
        # answer it asks for.
        subject = _over_threshold()
        page = _render("register.html", _login_page_facts(
            subject.render_params(CONTESTANT, REMOTE_IP)))

        self.assertIn("captchaToken", page)
        self.assertIn(subject.config.site_key, page)

    def test_a_deployment_without_a_captcha_renders_no_widget(self):
        # render_params leaves the widget empty when nothing is configured, so
        # the guard has to keep the markup out of a deployment that sets no key
        # rather than emitting an empty container.
        subject = configured(enabled=False)
        facts = subject.render_params(CONTESTANT, REMOTE_IP)
        self.assertEqual(facts["captcha_widget"], "")

        for template in ("contest.html", "register.html"):
            with self.subTest(template=template):
                page = _render(template, _login_page_facts(facts))

                self.assertNotIn("captchaToken", page)


class ApiLoginHandler:
    """A contest API login handler with only what its login path touches.

    WHY the real handler class rather than a copy of the gates: the refusal is
    the handler's decision, so the method under test has to be the one the
    server runs. What is replaced is everything around it -- the session, the
    ORM and the response writer -- none of which decides whether a captcha is
    demanded.
    """

    def __init__(self, subject, arguments=None):
        self.captcha = subject
        self.arguments = arguments if arguments is not None else {}
        self.request = Attributes(remote_ip=REMOTE_IP)
        self.answers: list = []
        self.contest = None
        self.sql_session = None
        self.timestamp = None

    post = api.ApiLoginHandler.post
    _may_examine_password = api.ApiLoginHandler._may_examine_password
    _answer_login_result = api.ApiLoginHandler._answer_login_result

    def get_argument(self, name, default=""):
        return self.arguments.get(name, default)

    def get_current_user(self):
        return None

    def create_signed_value(self, _name, value):
        return value

    def json(self, payload, status=200):
        self.answers.append((payload, status))


class ApiCaptchaGateTest(unittest.TestCase):
    """The captcha gate of the JSON login endpoint, which has no page."""

    def setUp(self):
        VALIDATED_LOGINS.clear()

    def test_a_token_login_is_not_challenged_over_the_threshold(self):
        # The endpoint answers JSON and never renders a widget, so a script
        # presenting an admin token could not answer a challenge however many
        # times it tried.
        subject = _over_threshold()
        handler = ApiLoginHandler(subject)

        self.assertTrue(handler._may_examine_password(CONTESTANT, "admin-token"))
        self.assertEqual(handler.answers, [])

    def test_a_login_without_a_token_is_still_challenged_over_the_threshold(self):
        # The exemption is for the token alone: a browser or a script that
        # presents none is taxed exactly as before.
        subject = _over_threshold()
        handler = ApiLoginHandler(subject)

        self.assertFalse(handler._may_examine_password(CONTESTANT, ""))
        self.assertEqual(handler.answers, [({"error": "Login failed"}, 403)])

    def test_a_login_below_the_threshold_never_reaches_the_provider(self):
        # is_required() is the single authority on whether a captcha is
        # demanded, so an untaxed attempt must not be verified at all.
        def refuse(*_args):
            raise AssertionError("the provider was reached below the threshold")

        subject = configured(verify=refuse)
        handler = ApiLoginHandler(subject)

        self.assertTrue(handler._may_examine_password(CONTESTANT, ""))
        self.assertEqual(handler.answers, [])

    def test_an_exempted_token_still_reaches_validate_login(self):
        # The exemption waives the challenge, not the credential check: the
        # token is handed on to be validated, so one that is invalid fails as an
        # ordinary rejected login rather than authenticating anyone.
        subject = _over_threshold()
        handler = ApiLoginHandler(subject, {
            "username": CONTESTANT, "password": "",
            "admin_token": "admin-token"})

        handler.post()

        self.assertEqual(len(VALIDATED_LOGINS), 1)
        self.assertEqual(VALIDATED_LOGINS[0][1]["admin_token"], "admin-token")
        self.assertEqual(handler.answers, [({"error": "Login failed"}, 403)])


if __name__ == "__main__":
    unittest.main(verbosity=2)