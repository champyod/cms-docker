#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2014 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2018 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2012-2014 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2013 Bernard Blackham <bernard@largestprime.net>
# Copyright © 2014 Artem Iglikov <artem.iglikov@gmail.com>
# Copyright © 2014 Fabian Gundlach <320pointsguy@gmail.com>
# Copyright © 2015-2018 William Di Luigi <williamdiluigi@gmail.com>
# Copyright © 2021 Grace Hawkins <amoomajid99@gmail.com>
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

"""Non-categorized handlers for CWS.

"""

import ipaddress
import json
import logging
import os.path
import re
import typing

import collections

from cms.db.contest import Contest

try:
    collections.MutableMapping
except:
    # Monkey-patch: Tornado 4.5.3 does not work on Python 3.11 by default
    collections.MutableMapping = collections.abc.MutableMapping

import tornado.web
from sqlalchemy.orm.exc import NoResultFound

from cms import config
from cms.db import User, Participation, Team, registerable_teams_query
from cms.grading.languagemanager import get_language
from cms.grading.steps import COMPILATION_MESSAGES, EVALUATION_MESSAGES
from cms.server import login_refusal, multi_contest
from cms.server.captcha import extract_provider, extract_token
from cms.server.contest.authentication import validate_login
from cms.server.contest.communication import get_communications
from cms.server.credits import get_surface
from cms.server.login_counters import login_attempt_context
from cms.server.login_refusal import LoginRefusal
from cmscommon.crypto import BCRYPT_MAX_PASSWORD_BYTES, hash_password, \
    validate_password
from cmscommon.datetime import make_datetime, make_timestamp
from .contest import ContestHandler, api_login_required
from ..phase_management import actual_phase_required


logger = logging.getLogger(__name__)


# Dummy function to mark translatable strings.
def N_(msgid):
    return msgid


def selectable_teams(sql_session, contest) -> list[Team]:
    """Return the teams a contestant may register into for this contest.

    A team is registerable when a contest_teams row says so for the contest;
    with no row it falls back to the team's own registerable flag.

    """
    return registerable_teams_query(
        sql_session, contest).order_by(Team.name).all()


def find_registerable_team(sql_session, contest, team_code: str) -> Team:
    """Return the team registerable for this contest that carries this code.

    raise: NoResultFound if no team registerable for the contest has the code,
        so a request naming a staff team is refused instead of honoured.

    """
    return registerable_teams_query(sql_session, contest).filter(
        Team.code == team_code).one()


class MainHandler(ContestHandler):
    """Home page handler.

    """
    @multi_contest
    def get(self):
        self.render("overview.html", **self.r_params)


class RegistrationHandler(ContestHandler):
    """Registration handler.

    Used to create a participation when this is allowed.
    If `new_user` argument is true, it creates a new user too.

    """

    MAX_INPUT_LENGTH = 50
    MIN_PASSWORD_LENGTH = 6

    @multi_contest
    def post(self):
        if not self.contest.allow_registration:
            raise tornado.web.HTTPError(404)

        # WHY the refusal's own status and not 403: this path already answers
        # 403 for "the password is not correct", and the browser's jQuery handler
        # tells the two apart by the code alone.
        refusal = login_refusal.registration_refusal(self.captcha.verify(
            self.get_argument("username", ""), self.request.remote_ip,
            extract_token(self), extract_provider(self)))
        if refusal is not None:
            logger.info("CAPTCHA refused on registration from IP %s: %s.",
                        self.request.remote_ip, refusal.reason)
            raise tornado.web.HTTPError(refusal.status)

        create_new_user = self.get_argument("new_user") == "true"

        # Get or create user
        if create_new_user:
            user = self._create_user()
        else:
            user = self._get_user()

            # Check if the participation exists
            contest = self.contest
            tot_participants = self.sql_session.query(Participation)\
                                   .filter(Participation.user == user)\
                                   .filter(Participation.contest == contest)\
                                   .count()
            if tot_participants > 0:
                raise tornado.web.HTTPError(409)

        # Create participation
        team = self._get_team()
        participation = Participation(user=user, contest=self.contest,
                                      team=team)
        self.sql_session.add(participation)

        self.sql_session.commit()

        self.finish(user.username)

    @multi_contest
    def get(self):
        if not self.contest.allow_registration:
            raise tornado.web.HTTPError(404)

        self.r_params["MAX_INPUT_LENGTH"] = self.MAX_INPUT_LENGTH
        self.r_params["MIN_PASSWORD_LENGTH"] = self.MIN_PASSWORD_LENGTH
        self.r_params["teams"] = selectable_teams(self.sql_session, self.contest)

        self.render("register.html", **self.r_params)

    def _create_user(self) -> User:
        try:
            first_name = self.get_argument("first_name")
            last_name = self.get_argument("last_name")
            username = self.get_argument("username")
            password = self.get_argument("password")
            email = self.get_argument("email")
            if len(email) == 0:
                email = None

            if not 1 <= len(first_name) <= self.MAX_INPUT_LENGTH:
                raise ValueError()
            if not 1 <= len(last_name) <= self.MAX_INPUT_LENGTH:
                raise ValueError()
            if not 1 <= len(username) <= self.MAX_INPUT_LENGTH:
                raise ValueError()
            if not re.match(r"^[A-Za-z0-9_-]+$", username):
                raise ValueError()
            if not self.MIN_PASSWORD_LENGTH <= len(password) \
                    <= self.MAX_INPUT_LENGTH:
                raise ValueError()
            # WHY bytes: bcrypt stores at most 72 bytes, and a longer password
            # would be hashed as its prefix, so it is refused here — where the
            # caller gets a 400 — instead of raising out of hash_password().
            if len(password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
                raise ValueError()
        except (tornado.web.MissingArgumentError, ValueError):
            raise tornado.web.HTTPError(400)

        # Override password with its hash
        password = hash_password(password)

        # Check if the username is available
        tot_users = self.sql_session.query(User)\
                        .filter(User.username == username).count()
        if tot_users != 0:
            # HTTP 409: Conflict
            raise tornado.web.HTTPError(409)

        # Store new user
        user = User(first_name, last_name, username, password, email=email)
        self.sql_session.add(user)

        return user

    def _get_user(self) -> User:
        username: str = self.get_argument("username")
        password: str = self.get_argument("password")

        # Find user if it exists
        user: User | None = (
            self.sql_session.query(User).filter(
                User.username == username).first()
        )
        if user is None:
            raise tornado.web.HTTPError(404)

        # Check if password is correct
        if not validate_password(user.password, password, user.username):
            # WHY count this: joining an existing account is the only
            # registration path that guesses a credential, so it is the one
            # that has to escalate into a captcha.
            self.captcha.record_failure(username, self.request.remote_ip, login_attempt_context("contest", self.request))
            raise tornado.web.HTTPError(403)

        return user

    def _get_team(self) -> Team | None:
        # If this contest offers registerable teams, we assume that the 'team'
        # field is mandatory. The count is over the contest's roster, so a
        # contest whose only teams are staff teams leaves the field optional,
        # exactly as a contest with no teams does.
        if registerable_teams_query(self.sql_session, self.contest).count() > 0:
            try:
                team_code: str = self.get_argument("team")
                team: Team | None = find_registerable_team(
                    self.sql_session, self.contest, team_code)
            except (tornado.web.MissingArgumentError, NoResultFound):
                raise tornado.web.HTTPError(400)
        else:
            team = None

        return team


class LoginHandler(ContestHandler):
    """Login handler.

    """
    @multi_contest
    def post(self):
        username: str = self.get_argument("username", "")
        password: str = self.get_argument("password", "")

        try:
            ip_address = ipaddress.ip_address(self.request.remote_ip)
        except ValueError:
            logger.warning("Invalid IP address provided by Tornado: %s",
                           self.request.remote_ip)
            return None

        refusal = self._may_examine_password(username)
        if refusal is not None:
            self._refuse(refusal)
            return

        participation, cookie = validate_login(
            self.sql_session, self.contest, self.timestamp, username, password,
            ip_address)

        self._apply_login_cookie(cookie)

        if participation is None:
            self.captcha.record_failure(username, self.request.remote_ip, login_attempt_context("contest", self.request))
            self.redirect(self._error_page(login_refusal.CREDENTIALS.reason))
        else:
            # WHY record_success here: whoever finally gets the password right
            # has proven they are not guessing, so the failures behind this
            # account and address are dropped and a mistyped password cannot
            # accumulate into a lockout.
            self.captcha.record_success(username, self.request.remote_ip)
            self.redirect(self._next_page())

    def _may_examine_password(self, username: str
                              ) -> typing.Optional[LoginRefusal]:
        """Return the refusal that stops this attempt, None to examine the password.

        The lockout gate and the captcha gate in the order they have to run in,
        neither of them charging a failure the attempt did not earn.

        """
        ip = self.request.remote_ip

        # WHY the lockout first: while it holds it is what refused the attempt,
        # and a challenge refusal would send the user to fix a captcha that is
        # not the obstacle while calling the provider for nothing.
        # WHY not recorded as another failure: the count is already at the
        # threshold and is never reset while the window is live, so incrementing
        # it here would slide the window forward on every attempt and turn a
        # lockout someone waits out into one that never ends for an address that
        # keeps trying. is_locked is not gated on the captcha being configured,
        # so a deployment with it off is still refused.
        if self.captcha.is_locked(username, ip):
            logger.info("Login refused, account or IP %r locked out from IP %s.",
                        username, ip)
            return login_refusal.locked_refusal(
                self.captcha.counters.retry_after(username, ip))

        # WHY the captcha comes before the credential check: a wrong or forged
        # answer must not be worth anything to an attacker, so the credentials
        # are not examined until the challenge has passed.
        refusal = login_refusal.refusal_for_outcome(self.captcha.verify(
            username, ip, extract_token(self), extract_provider(self)))
        if refusal is not None:
            logger.info("CAPTCHA refused for user %r from IP %s: %s.", username,
                        ip, refusal.reason)
        return refusal

    def _next_page(self) -> str:
        """Return where a successful login leads."""
        next_page: str | None = self.get_argument("next", None)
        if next_page is None:
            return self.contest_url()
        if next_page == "/":
            return self.url()
        return self.url(*next_page.strip("/").split("/"))

    def _error_page(self, reason: str) -> str:
        """Return the login page URL carrying the refusal's reason.

        WHY the username rides in the redirect: the login page recomputes the
        captcha from the counters, and a loopback client has no address bucket to
        read, so without the username the account's own count would be invisible
        and the widget would stay away while the next attempt is refused for
        lacking its token.

        """
        error_args = {"login_error": reason}
        username = self.get_argument("username", "")
        if len(username) > 0:
            error_args["username"] = username
        next_page: str | None = self.get_argument("next", None)
        if next_page is not None:
            error_args["next"] = next_page
        return self.contest_url(**error_args)

    def _refuse(self, refusal: LoginRefusal) -> None:
        """Answer one refusal: the status page for a lockout, the form otherwise."""
        if refusal.status == login_refusal.LOCKED_STATUS:
            self._refuse_locked_out(refusal)
            return
        self.redirect(self._error_page(refusal.reason))

    def _apply_login_cookie(self, cookie: bytes | None) -> None:
        """Issue the contest's login cookie, or drop the one held.

        A rejected login answers with no cookie value, and that has to clear
        the stale one instead of leaving it in place for the next request.

        """
        cookie_name = self.contest.name + "_login"
        if cookie is None:
            self.clear_cookie(cookie_name)
            return
        self.set_secure_cookie(
            cookie_name,
            cookie,
            expires_days=None,
            max_age=config.contest_web_server.cookie_duration,
        )

    def _refuse_locked_out(self, refusal: LoginRefusal) -> None:
        """Answer an attempt from a locked-out account or address.

        The status is raised rather than rendered: the surrounding page shows
        the form again after an ordinary failure, and a lockout is not
        something the client can talk its way out of on the next try. The
        registration path in this file uses the same idiom.

        """
        self.set_header("Retry-After", str(refusal.retry_after))
        # WHY carried on the handler too: write_error renders the status page,
        # and it is the only place a locked-out user is told why and for how
        # long, so the window has to reach the template.
        self.lockout_retry_after = refusal.retry_after
        raise tornado.web.HTTPError(refusal.status)


class StartHandler(ContestHandler):
    """Start handler.

    Used by a user who wants to start their per_user_time.

    """
    @tornado.web.authenticated
    @actual_phase_required(-1)
    @multi_contest
    def post(self):
        participation: Participation = self.current_user

        logger.info("Starting now for user %s", participation.user.username)
        participation.starting_time = self.timestamp
        self.sql_session.commit()

        self.redirect(self.contest_url())


class LogoutHandler(ContestHandler):
    """Logout handler.

    """
    @multi_contest
    def post(self):
        self.clear_cookie(self.contest.name + "_login")
        self.redirect(self.contest_url())


class NotificationsHandler(ContestHandler):
    """Displays notifications.

    """

    refresh_cookie = False

    @api_login_required
    @multi_contest
    def get(self):
        participation: Participation = self.current_user

        last_notification: str | None = self.get_argument(
            "last_notification", None)
        if last_notification is not None:
            last_notification = make_datetime(float(last_notification))

        res = get_communications(self.sql_session, participation,
                                 self.timestamp, after=last_notification)

        # Simple notifications
        notifications = self.service.notifications
        username = participation.user.username
        if username in notifications:
            for notification in notifications[username]:
                res.append({"type": "notification",
                            "timestamp": make_timestamp(notification[0]),
                            "subject": notification[1],
                            "text": notification[2],
                            "level": notification[3]})
            del notifications[username]

        self.write(json.dumps(res))


class DocumentationHandler(ContestHandler):
    """Displays the instruction (compilation lines, documentation,
    ...) of the contest.

    """
    @tornado.web.authenticated
    @multi_contest
    def get(self):
        contest: Contest = self.r_params.get("contest")
        languages = [get_language(lang) for lang in contest.languages]

        language_docs = []
        if config.contest_web_server.docs_path is not None:
            for language in languages:
                ext = language.source_extensions[0][1:]  # remove dot
                path = os.path.join(config.contest_web_server.docs_path, ext)
                if os.path.exists(path):
                    language_docs.append((language.name, ext))
        else:
            language_docs.append(("C++", "en"))

        self.render("documentation.html",
                    COMPILATION_MESSAGES=COMPILATION_MESSAGES,
                    EVALUATION_MESSAGES=EVALUATION_MESSAGES,
                    language_docs=language_docs,
                    **self.r_params)


class CreditsHandler(ContestHandler):
    """Displays the licence and the bundled third-party software.

    Unauthenticated, like the home page: the footer links here from every page
    including the login form, and section 13 of the licence addresses every
    user interacting with the server, not only the ones holding an account.
    Nothing rendered here is contest- or user-specific.

    """
    @multi_contest
    def get(self):
        self.render("credits.html",
                    credits_surface=get_surface("contest"),
                    **self.r_params)
