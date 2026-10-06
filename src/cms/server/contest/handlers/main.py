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
from cms.db import User, Participation, Team
from cms.grading.languagemanager import get_language
from cms.grading.steps import COMPILATION_MESSAGES, EVALUATION_MESSAGES
from cms.server import multi_contest
from cms.server.captcha import extract_token
from cms.server.contest.authentication import validate_login
from cms.server.contest.communication import get_communications
from cms.server.credits import get_surface
from cmscommon.crypto import hash_password, validate_password
from cmscommon.datetime import make_datetime, make_timestamp
from .contest import ContestHandler, api_login_required
from ..phase_management import actual_phase_required


logger = logging.getLogger(__name__)


# WHY 429 for a lockout and not the 403 this handler answers a wrong password
# with: a client, a proxy or a WAF has to be able to tell "stop trying" from
# "wrong password", otherwise the refusal reads as an ordinary failed login and
# there is nothing to act on. 429 is what the registration path already uses
# here to mean "this attempt was refused before the credential was checked", and
# Retry-After tells the caller how long the window lasts.
LOGIN_LOCKED_STATUS = 429
LOGIN_LOCKED_RETRY_AFTER = 15 * 60


# Dummy function to mark translatable strings.
def N_(msgid):
    return msgid


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

        # WHY 429 and not 403: this path already answers 403 for "the password
        # is not correct", so a captcha refusal needs its own code for the
        # browser's jQuery handler to tell apart from a genuine credential
        # error. 429 also describes what actually happened, and the handler's
        # own script shows the widget again after it.
        if not self.captcha.verify(self.get_argument("username", ""),
                                   self.request.remote_ip, extract_token(self)):
            logger.info("CAPTCHA rejected on registration from IP %s.",
                        self.request.remote_ip)
            raise tornado.web.HTTPError(429)

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
        self.r_params["teams"] = self.sql_session.query(Team)\
                                     .order_by(Team.name).all()

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
        if not validate_password(user.password, password):
            # WHY count this: joining an existing account is the only
            # registration path that guesses a credential, so it is the one
            # that has to escalate into a captcha.
            self.captcha.record_failure(username, self.request.remote_ip)
            raise tornado.web.HTTPError(403)

        return user

    def _get_team(self) -> Team | None:
        # If we have teams, we assume that the 'team' field is mandatory
        if self.sql_session.query(Team).count() > 0:
            try:
                team_code: str = self.get_argument("team")
                team: Team | None = (
                    self.sql_session.query(Team).filter(
                        Team.code == team_code).one()
                )
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
        next_page, error_page = self._login_pages()

        username: str = self.get_argument("username", "")
        password: str = self.get_argument("password", "")

        try:
            ip_address = ipaddress.ip_address(self.request.remote_ip)
        except ValueError:
            logger.warning("Invalid IP address provided by Tornado: %s",
                           self.request.remote_ip)
            return None

        if not self._may_examine_password(username):
            self.redirect(error_page)
            return

        participation, cookie = validate_login(
            self.sql_session, self.contest, self.timestamp, username, password,
            ip_address)

        self._apply_login_cookie(cookie)

        if participation is None:
            self.captcha.record_failure(username, self.request.remote_ip)
            self.redirect(error_page)
        else:
            # WHY record_success here: whoever finally gets the password right
            # has proven they are not guessing, so the failures behind this
            # account and address are dropped and a mistyped password cannot
            # accumulate into a lockout.
            self.captcha.record_success(username, self.request.remote_ip)
            self.redirect(next_page)

    def _may_examine_password(self, username: str) -> bool:
        """Return whether this attempt may reach the password check.

        The captcha gate and the lockout gate in the order they have to run in,
        so that neither layer is accidentally moved past the credential check.

        """
        # WHY the captcha comes first: a wrong or forged answer must not be
        # worth anything to an attacker, so the credentials are not examined
        # until the captcha has passed.
        if not self.captcha.verify(
                username, self.request.remote_ip, extract_token(self)):
            logger.info("CAPTCHA rejected for user %r from IP %s.", username,
                        self.request.remote_ip)
            return False

        # WHY the lockout comes after it and before validate_login: the password
        # of a locked-out account is the work the lockout exists to skip, and
        # this form has no admin token, so there is no impersonation path to
        # exempt here. is_locked is not gated on the captcha being configured,
        # so a deployment with it off is still refused.
        if self.captcha.is_locked(username, self.request.remote_ip):
            # WHY not recorded as another failure: the count is already at the
            # threshold and is never reset while the window is live, so
            # incrementing it here would slide the window forward on every
            # attempt and turn a lockout someone waits out into one that never
            # ends for an address that keeps trying.
            logger.info("Login refused, account or IP %r locked out from IP %s.",
                        username, self.request.remote_ip)
            self._refuse_locked_out()

        return True

    def _login_pages(self) -> tuple[str, str]:
        """Return where a failed and a successful login lead.

        Split out of `post` so the redirect targets are built once and the
        handler's own flow stays readable.

        """
        error_args = {"login_error": "true"}
        next_page: str | None = self.get_argument("next", None)
        if next_page is not None:
            error_args["next"] = next_page
            if next_page != "/":
                next_page = self.url(*next_page.strip("/").split("/"))
            else:
                next_page = self.url()
        else:
            next_page = self.contest_url()
        return next_page, self.contest_url(**error_args)

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

    def _refuse_locked_out(self) -> None:
        """Answer an attempt from a locked-out account or address.

        The status is raised rather than rendered: the surrounding page shows
        the form again after an ordinary failure, and a lockout is not
        something the client can talk its way out of on the next try. The
        registration path in this file uses the same idiom.

        """
        self.set_header("Retry-After", str(LOGIN_LOCKED_RETRY_AFTER))
        raise tornado.web.HTTPError(LOGIN_LOCKED_STATUS)


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

    Authenticated like the documentation page: the nav entry that reaches it
    only exists on an authenticated page, and the offer of the corresponding
    source is served to the contestants the server is serving.

    """
    @tornado.web.authenticated
    @multi_contest
    def get(self):
        self.render("credits.html",
                    credits_surface=get_surface("contest"),
                    **self.r_params)
