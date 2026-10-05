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

"""Tests for authentication functions.

"""

import ipaddress
import unittest
from datetime import timedelta
from unittest.mock import patch

from cmstestsuite.unit_tests.databasemixin import DatabaseMixin, \
    DatabaseObjectGeneratorMixin

from cms import config
from cms.conf import CaptchaConfig
from cms.server.captcha import Captcha
from cms.server.contest.authentication import validate_login, \
    authenticate_request
from cms.server.login_counter_backend import InProcessBackend
from cms.server.login_counters import FAILURE_WINDOW, LoginFailureCounters
# Prefer build_password (which defaults to a plaintext method) over
# hash_password (which defaults to bcrypt) as it is a lot faster.
from cmscommon.crypto import build_password, hash_password
from cmscommon.datetime import make_datetime


# A routable, non-loopback address: a loopback client is exempt from the
# per-IP bucket, which is the exemption the escalation cases below must not
# accidentally lean on.
LOCKOUT_IP = "203.0.113.7"
BAN_THRESHOLD = 5


class TestValidateLogin(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()
        self.timestamp = make_datetime()
        self.add_contest()
        self.contest = self.add_contest(allow_password_authentication=True)
        self.add_user(username="otheruser")
        self.user = self.add_user(
            username="myuser", password=build_password("mypass"))
        self.participation = self.add_participation(
            contest=self.contest, user=self.user)

        # Set up a temporary admin token
        patcher = patch.object(
            config.contest_web_server, "contest_admin_token", "admin-token"
        )
        self.addCleanup(patcher.stop)
        patcher.start()


    def assertSuccess(self, username, password, ip_address, admin_token=""):
        # We had an issue where due to a misuse of contains_eager we ended up
        # with the wrong user attached to the participation. This only happens
        # if the correct user isn't already in the identity map, which is what
        # these lines trigger.
        self.session.flush()
        self.session.expire(self.user)
        self.session.expire(self.contest)

        authenticated_participation, cookie = validate_login(
            self.session, self.contest, self.timestamp,
            username, password, ipaddress.ip_address(ip_address),
            admin_token)

        self.assertIsNotNone(authenticated_participation)
        self.assertIsNotNone(cookie)
        self.assertIs(authenticated_participation, self.participation)
        self.assertIs(authenticated_participation.user, self.user)
        self.assertIs(authenticated_participation.contest, self.contest)

    def assertFailure(self, username, password, ip_address, admin_token=""):
        authenticated_participation, cookie = validate_login(
            self.session, self.contest, self.timestamp,
            username, password, ipaddress.ip_address(ip_address),
            admin_token)

        self.assertIsNone(authenticated_participation)
        self.assertIsNone(cookie)

    def test_successful_login(self):
        self.assertSuccess("myuser", "mypass", "127.0.0.1")

    def test_no_user(self):
        self.assertFailure("myotheruser", "mypass", "127.0.0.1")

    def test_no_participation_for_user_in_contest(self):
        other_contest = self.add_contest(allow_password_authentication=True)
        other_user = self.add_user(
            username="myotheruser", password=build_password("mypass"))
        self.add_participation(contest=other_contest, user=other_user)

        self.assertFailure("myotheruser", "mypass", "127.0.0.1")

    def test_participation_specific_password(self):
        self.participation.password = build_password("myotherpass")

        self.assertFailure("myuser", "mypass", "127.0.0.1")
        self.assertSuccess("myuser", "myotherpass", "127.0.0.1")

    def test_unallowed_password_authentication(self):
        self.contest.allow_password_authentication = False

        self.assertFailure("myuser", "mypass", "127.0.0.1")

    def test_unallowed_hidden_participation(self):
        self.contest.block_hidden_participations = True
        self.participation.hidden = True

        self.assertFailure("myuser", "mypass", "127.0.0.1")

    def test_invalid_password_stored_in_user(self):
        # It's invalid, as it's not created by build_password.
        self.user.password = "mypass"

        # Mainly checks that no exception is raised.
        self.assertFailure("myuser", "mypass", "127.0.0.1")

    def test_invalid_password_stored_in_participation(self):
        # It's invalid, as it's not created by build_password.
        self.participation.password = "myotherpass"

        # Mainly checks that no exception is raised.
        self.assertFailure("myuser", "myotherpass", "127.0.0.1")

    def test_ip_lock(self):
        self.contest.ip_restriction = True
        self.participation.ip = [ipaddress.ip_network("10.0.0.0/24")]

        self.assertSuccess("myuser", "mypass", "10.0.0.1")
        self.assertFailure("myuser", "wrongpass", "10.0.0.1")
        self.assertFailure("myuser", "mypass", "10.0.1.1")

        self.participation.ip = [ipaddress.ip_network("10.9.0.0/24"),
                                 ipaddress.ip_network("127.0.0.1/32")]

        self.assertSuccess("myuser", "mypass", "127.0.0.1")
        self.assertFailure("myuser", "mypass", "127.0.0.0")
        self.assertSuccess("myuser", "mypass", "10.9.0.7")

        # Corner cases.
        self.participation.ip = []
        self.assertFailure("myuser", "mypass", "10.0.0.1")

        self.participation.ip = None
        self.assertSuccess("myuser", "mypass", "10.0.0.1")

    def test_deactivated_ip_lock(self):
        self.contest.ip_restriction = False
        self.participation.ip = [ipaddress.ip_network("10.0.0.0/24")]

        self.assertSuccess("myuser", "mypass", "10.0.1.1")

    def test_successful_impersonation(self):
        self.assertSuccess("myuser", "", "127.0.0.1", "admin-token")

    def test_unsuccessful_impersonation(self):
        self.assertFailure("myuser", "", "127.0.0.1", "bad-admin-token")

    def test_impersonation_overrides_unallowed_password_authentication(self):
        self.contest.allow_password_authentication = False

        self.assertSuccess("myuser", "", "127.0.0.1", "admin-token")

    def test_impersonation_overrides_unallowed_hidden_participation(self):
        self.contest.block_hidden_participations = True
        self.participation.hidden = True

        self.assertSuccess("myuser", "", "127.0.0.1", "admin-token")

    def test_impersonation_overrides_ip_lock(self):
        self.contest.ip_restriction = True
        self.participation.ip = [ipaddress.ip_network("10.0.0.0/24")]

        self.assertSuccess("myuser", "mypass", "10.0.0.1", "admin-token")
        self.assertSuccess("myuser", "mypass", "10.0.1.1", "admin-token")


class TestAuthenticateRequest(DatabaseMixin, unittest.TestCase):

    def setUp(self):
        super().setUp()
        self.timestamp = make_datetime()
        self.add_contest()
        self.contest = self.add_contest()
        self.user = self.add_user(
            username="myuser", password=build_password("mypass"))
        self.participation = self.add_participation(
            contest=self.contest, user=self.user)
        _, self.cookie = validate_login(
            self.session, self.contest, self.timestamp, self.user.username,
            "mypass", ipaddress.ip_address("10.0.0.1"))

        # For testing impersonation by admin token
        self.impersonated_user = self.add_user(username="otheruser")
        self.impersonated_participation = self.add_participation(
            contest=self.contest, user=self.impersonated_user)
        with patch.object(
            config.contest_web_server, "contest_admin_token", "admin-token"
        ):
            _, self.impersonated_cookie = validate_login(
                self.session, self.contest, self.timestamp, "otheruser",
                "", ipaddress.ip_address("10.0.0.2"), "admin-token")

    def attempt_authentication(self, db_flush=True, **kwargs):
        # We had an issue where due to a misuse of contains_eager we ended up
        # with the wrong user attached to the participation. This only happens
        # if the correct user isn't already in the identity map, which is what
        # these lines trigger.
        if db_flush:
            self.session.flush()
            self.session.expire(self.user)
            self.session.expire(self.impersonated_user)
            self.session.expire(self.contest)

        # The arguments need to be passed as keywords and are timestamp, cookie
        # and ip_address. A missing argument means the default value is used
        # instead. An argument passed as None means that None will be used.
        return authenticate_request(
            self.session, self.contest,
            kwargs.get("timestamp", self.timestamp),
            kwargs.get("cookie", self.cookie),
            kwargs.get("authorization", None),
            ipaddress.ip_address(kwargs.get("ip_address", "10.0.0.1")))

    def assertSuccess(self, **kwargs):
        authenticated_participation, cookie, impersonated = \
            self.attempt_authentication(**kwargs)

        self.assertIsNotNone(authenticated_participation)
        self.assertIs(authenticated_participation, self.participation)
        self.assertIs(authenticated_participation.user, self.user)
        self.assertIs(authenticated_participation.contest, self.contest)
        self.assertIs(impersonated, False)

        return cookie

    def assertSuccessAndCookieRefreshed(self, **kwargs):
        # Assert that the authentication succeeds and that a cookie is returned
        # as well, to be refreshed on the client. (This typically indicates
        # that the authentication was performed through the cookie.)
        # The arguments are the same as those of attempt_authentication.
        cookie = self.assertSuccess(**kwargs)
        self.assertIsNotNone(cookie)
        return cookie

    def assertSuccessAndCookieCleared(self, **kwargs):
        # Assert that the authentication succeeds and no cookie is returned,
        # meaning that it needs to be cleared (or left unset) on the client.
        # (This typically indicates that the authentication occurred by IP
        # autologin.)
        # The arguments are the same as those of attempt_authentication.
        cookie = self.assertSuccess(**kwargs)
        self.assertIsNone(cookie)

    def assertImpersonationSuccess(self, **kwargs):
        # Assert that the impersonation succeeds.
        # The arguments are the same as those of attempt_authentication.

        authenticated_participation, cookie, impersonated = \
            self.attempt_authentication(cookie=self.impersonated_cookie, **kwargs)

        self.assertIsNotNone(authenticated_participation)
        self.assertIs(authenticated_participation, self.impersonated_participation)
        self.assertIs(authenticated_participation.user, self.impersonated_user)
        self.assertIs(authenticated_participation.contest, self.contest)
        self.assertIs(impersonated, True)

        return cookie

    def assertFailure(self, **kwargs):
        # Assert that the authentication fails.
        # The arguments are the same as those of attempt_authentication.
        authenticated_participation, cookie, impersonated = \
            self.attempt_authentication(**kwargs)
        self.assertIsNone(authenticated_participation)
        self.assertIsNone(cookie)
        self.assertIs(impersonated, False)

    @patch.object(config.contest_web_server, "cookie_duration", 10)
    def test_cookie_contains_timestamp(self):
        self.contest.ip_autologin = False
        self.contest.allow_password_authentication = True

        # The cookie allows to authenticate.
        self.assertSuccessAndCookieRefreshed()

        # Until the duration expires.
        new_cookie = self.assertSuccessAndCookieRefreshed(
            timestamp=self.timestamp + timedelta(seconds=8))

        # But not after it expires.
        self.assertFailure(timestamp=self.timestamp + timedelta(seconds=14))

        # Unless the cookie is refreshed.
        self.assertSuccessAndCookieRefreshed(
            timestamp=self.timestamp + timedelta(seconds=14),
            cookie=new_cookie)

    def test_cookie_contains_password(self):
        self.contest.ip_autologin = False

        # Cookies are of no use if one cannot login by password.
        self.contest.allow_password_authentication = False
        self.assertFailure()
        self.contest.allow_password_authentication = True

        # Cookies contain the password, which is validated every time.
        self.user.password = build_password("newpass")
        self.assertFailure()

        # Contest-specific passwords take precedence over global ones.
        self.participation.password = build_password("mypass")
        self.assertSuccessAndCookieRefreshed()

        # And they do so in the negative case too.
        self.user.password = build_password("mypass")
        self.participation.password = build_password("newpass")
        self.assertFailure()

    def test_ip_autologin(self):
        self.contest.ip_autologin = True
        self.contest.allow_password_authentication = False

        self.participation.ip = [ipaddress.ip_network("10.0.0.1/32")]
        self.assertSuccessAndCookieCleared()

        self.assertFailure(ip_address="10.1.0.1")

        self.participation.ip = [ipaddress.ip_network("10.0.0.0/24")]
        self.assertFailure()

    def test_ip_autologin_with_ambiguous_addresses(self):
        # If two users have the same IP address neither of them can autologin.
        self.contest.ip_autologin = True
        self.contest.allow_password_authentication = False
        self.participation.ip = [ipaddress.ip_network("10.0.0.1/32")]
        other_user = self.add_user()
        other_participation = self.add_participation(
            contest=self.contest, user=other_user,
            ip=[ipaddress.ip_network("10.0.0.1/32")])
        self.assertFailure()

        # In fact, they don't even fall back to cookie-based authentication.
        self.contest.allow_password_authentication = True
        self.assertFailure()

        # But if IP autologin is disabled altogether, ambiguous IP addresses
        # are disregarded and cookie-based authentication kicks in.
        self.contest.ip_autologin = False
        self.assertSuccessAndCookieRefreshed()

        # Ambiguous IP addresses are allowed if only one of them is non-hidden
        # (and hidden users are barred from logging in).
        self.contest.ip_autologin = True
        self.contest.block_hidden_participations = True
        other_participation.hidden = True
        self.assertSuccessAndCookieCleared()

        # But not if hidden users aren't blocked.
        self.contest.block_hidden_participations = False
        self.assertFailure()

    def test_invalid_password_in_database(self):
        self.contest.ip_autologin = False
        self.contest.allow_password_authentication = True
        self.user.password = "not a valid password"
        self.assertFailure()

        self.user.password = build_password("mypass")
        self.participation.password = "not a valid password"
        self.assertFailure()

    def test_invalid_cookie(self):
        self.contest.ip_autologin = False
        self.contest.allow_password_authentication = True
        self.assertFailure(cookie=None)
        self.assertFailure(cookie="not a valid cookie")

    def test_authorization_header(self):
        self.contest.ip_autologin = False
        self.contest.allow_password_authentication = True
        self.assertSuccess(cookie=None, authorization=self.cookie)

    def test_no_user(self):
        self.session.delete(self.user)
        self.assertFailure(db_flush=False)

    def test_no_participation_for_user_in_contest(self):
        self.session.delete(self.participation)
        self.assertFailure()

    def test_hidden_user(self):
        self.contest.ip_autologin = True
        self.contest.allow_password_authentication = True
        self.contest.block_hidden_participations = True
        self.participation.hidden = True
        self.assertFailure()

    def test_ip_lock(self):
        self.contest.ip_autologin = True
        self.contest.allow_password_authentication = True
        self.contest.ip_restriction = True
        self.participation.ip = [ipaddress.ip_network("10.0.0.0/24"),
                                 ipaddress.ip_network("127.0.0.1/32")]

        self.assertSuccessAndCookieCleared(ip_address="127.0.0.1")
        self.assertSuccessAndCookieRefreshed(ip_address="10.0.0.1")
        self.assertFailure(ip_address="10.1.0.1")

        self.contest.ip_restriction = False
        self.assertSuccessAndCookieRefreshed()

        # Corner cases.
        self.contest.ip_restriction = True
        self.participation.ip = []
        self.assertFailure()

        self.participation.ip = None
        self.assertSuccessAndCookieRefreshed()

    def test_impersonate(self):
        self.contest.ip_autologin = False
        self.contest.allow_password_authentication = False
        self.assertImpersonationSuccess()

    def test_impersonate_overridden_by_ip_autologin(self):
        self.contest.ip_autologin = True
        self.contest.allow_password_authentication = False

        self.participation.ip = [ipaddress.ip_network("10.0.0.1/32")]
        self.assertSuccessAndCookieCleared(cookie=self.impersonated_cookie)

    def test_impersonation_overrides_unallowed_hidden_participation(self):
        self.contest.block_hidden_participations = True
        self.participation.hidden = True
        self.assertImpersonationSuccess()

    def test_impersonation_overrides_ip_lock(self):
        self.contest.ip_restriction = True
        self.participation.ip = [ipaddress.ip_network("10.0.0.0/24")]

        self.assertImpersonationSuccess(ip_address="10.0.0.1")
        self.assertImpersonationSuccess(ip_address="10.0.1.1")


class ManualClock:
    """A clock the tests move by hand.

    A failure window is measured in minutes, so letting one lapse by waiting
    would make the suite slow and flaky. Driving the clock the backend already
    accepts keeps the assertion on the behaviour rather than on a private
    timestamp rewritten behind the code's back.
    """

    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def build_captcha(clock=None, **overrides):
    """Return a Captcha with injected counters and a stubbed verifier.

    WHY built here rather than through ContestHandler's captcha property: that
    property caches one Captcha on the class for the whole process, so a test
    reading it would observe whatever an earlier test left there. Injecting the
    counters keeps every case below independent of that shared state.
    """
    values = {
        "enabled": True,
        "provider": "turnstile",
        "site_key": "site-key",
        "secret_key": "secret",
        "threshold": 3,
        "ban_threshold": BAN_THRESHOLD,
    }
    values.update(overrides)
    counts = LoginFailureCounters(
        backend=InProcessBackend(clock=clock) if clock is not None
        else InProcessBackend())
    return Captcha(CaptchaConfig(**values), counters=counts,
                   verify=lambda *_args: True)


class TestLoginLockout(DatabaseObjectGeneratorMixin, unittest.TestCase):
    """The lockout the login handlers gate on before validating a password.

    Both handlers ask the Captcha whether an account and address are refused
    and skip the credential check when it says yes, so the captcha's report is
    the whole boundary: nothing below it would refuse anything.

    WHY the object generator mixin rather than DatabaseMixin: the account under
    test only has to exist, and the generator builds it without a session, so
    the lockout behaviour is decided without standing a database up. What the
    lockout reads is the captcha's own state, not the participation.
    """

    def setUp(self):
        self.captcha = build_captcha()
        self.user = self.get_user(
            username="myuser", password=build_password("mypass"))
        self.contest = self.get_contest(allow_password_authentication=True)
        self.participation = self.get_participation(
            contest=self.contest, user=self.user)

    def fail_login(self, captcha, username="myuser", ip_address=LOCKOUT_IP):
        """Refuse one login attempt, as a handler refusing a password does.

        WHY nothing here asks the captcha to verify a token: a refusal past
        the threshold is answered before validate_login is ever reached, and
        an answer the captcha itself produces would test the captcha rather
        than the lockout. The handlers likewise never record a failure on an
        attempt they refuse for the lockout, so neither does this, which
        keeps the counter a count of wrong passwords, not of refusals.
        """
        captcha.record_failure(username, ip_address)

    def answer_login(self, captcha, username="myuser", ip_address=LOCKOUT_IP):
        """Answer the lockout query of one attempt, as a handler does."""
        return captcha.is_locked(username, ip_address)

    def assertDemandsAToken(self, captcha, username="myuser",
                            ip_address=LOCKOUT_IP):
        """Assert this captcha stops the attempt before the password is read.

        The captcha threshold sits below the ban threshold, so a run of
        failures passes through a demand for a token on the way to the
        refusal: an account can be challenged and still be guessable, and
        the lockout is what bounds that guessing.
        """
        self.assertTrue(captcha.verify(username, ip_address, "good"))

    def assertLocksOut(self, captcha, username="myuser",
                       ip_address=LOCKOUT_IP):
        """Assert this captcha refuses the attempt, and return nothing."""
        self.assertTrue(self.answer_login(captcha, username, ip_address))

    def assertNotLockedOut(self, captcha, username="myuser",
                           ip_address=LOCKOUT_IP):
        """Assert this captcha lets the attempt reach the password."""
        self.assertFalse(self.answer_login(captcha, username, ip_address))

    def test_the_ban_threshold_refuses_the_attempt(self):
        for _ in range(BAN_THRESHOLD - 1):
            self.fail_login(self.captcha)

        # One failure short of the ban the attempt is only challenged, and a
        # client that answers the challenge can still get in.
        self.assertDemandsAToken(self.captcha)
        self.assertNotLockedOut(self.captcha)

        self.fail_login(self.captcha)
        self.assertLocksOut(self.captcha)

    def test_every_attempt_past_the_threshold_stays_refused(self):
        # A count that restarted at the threshold re-armed itself on the next
        # attempt, so the sixth guess was counted as the first and the account
        # stayed guessable without limit: that is what the retained count buys.
        for _ in range(BAN_THRESHOLD):
            self.fail_login(self.captcha)
        for _ in range(3):
            self.fail_login(self.captcha)
            self.assertLocksOut(self.captcha)

    def test_a_successful_login_clears_the_failures_behind_it(self):
        for _ in range(BAN_THRESHOLD - 1):
            self.fail_login(self.captcha)

        self.captcha.record_success("myuser", LOCKOUT_IP)

        self.assertNotLockedOut(self.captcha)
        self.assertEqual(self.captcha.counters.count("myuser", LOCKOUT_IP), 0)

    def test_rotating_usernames_still_escalates_the_address(self):
        # The per-account bucket is what an attacker on one account exhausts
        # first, so rotating usernames must not buy a fresh allowance: every
        # failure also feeds the address bucket.
        for index in range(BAN_THRESHOLD):
            self.fail_login(self.captcha, username="user-%d" % index)

        self.assertLocksOut(self.captcha, username="user-0")
        self.assertLocksOut(self.captcha, username="user-never-attempted")

    def test_the_lockout_holds_with_no_captcha_configured(self):
        # is_enabled() is False by default and for a deployment that sets
        # nothing, so a lockout gated on it would be inert exactly where it is
        # most needed. The refusal has to survive a captcha that cannot be
        # demanded at all.
        self.captcha = build_captcha(enabled=False, site_key="", secret_key="")
        self.assertFalse(self.captcha.is_enabled())

        for _ in range(BAN_THRESHOLD):
            self.fail_login(self.captcha)

        self.assertLocksOut(self.captcha)
        self.fail_login(self.captcha)
        self.assertLocksOut(self.captcha)

    def test_a_lapsed_window_releases_the_lockout(self):
        # A user who mistyped a few times, walked away and came back must not
        # be held out forever, so the count has to lapse on its own.
        clock = ManualClock()
        self.captcha = build_captcha(clock=clock)
        for _ in range(BAN_THRESHOLD - 1):
            self.fail_login(self.captcha)
        self.assertNotLockedOut(self.captcha)

        clock.advance(FAILURE_WINDOW + 1)

        self.assertEqual(self.captcha.counters.count("myuser", LOCKOUT_IP), 0)
        self.assertNotLockedOut(self.captcha)


if __name__ == "__main__":
    unittest.main()
