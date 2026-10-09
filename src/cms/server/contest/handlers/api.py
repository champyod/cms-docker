#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2025 Luca Versari <veluca93@gmail.com>
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

"""API handlers for CMS.

"""

import ipaddress
import logging

from cms.db.submission import Submission
from cms.db.user import Participation
from cms.server import multi_contest
from cms.server.captcha import extract_token
from cms.server.contest.authentication import validate_login
from cms.server.contest.submission import \
    UnacceptableSubmission, accept_submission
from .contest import ContestHandler, api_login_required
from ..phase_management import actual_phase_required

logger = logging.getLogger(__name__)


# WHY 429 for a lockout and not the 403 every other rejection on this endpoint
# answers with: a client, a script or a WAF has to be able to tell "stop
# trying" from "wrong password", otherwise the refusal is indistinguishable
# from an ordinary failed login and nothing can be acted on. 429 is what the
# registration path uses in the sibling handler for the same meaning, that of
# an attempt refused before the credential was checked.
LOGIN_LOCKED_STATUS = 429


class ApiContestHandler(ContestHandler):
    """An extension of ContestHandler marking the request as a part of the API.

    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.api_request = True


class ApiLoginHandler(ApiContestHandler):
    """Login handler.

    """
    @multi_contest
    def post(self):
        current_user = self.get_current_user()

        username = self.get_argument("username", "")
        password = self.get_argument("password", "")
        admin_token = self.get_argument("admin_token", "")

        if current_user is not None:
            self._answer_already_logged_in(username)
            return

        try:
            ip_address = ipaddress.ip_address(self.request.remote_ip)
        except ValueError:
            logger.warning("Invalid IP address provided by Tornado: %s",
                           self.request.remote_ip)
            return None

        if not self._may_examine_password(username, admin_token):
            return

        participation, login_data = validate_login(
            self.sql_session, self.contest, self.timestamp, username, password,
            ip_address, admin_token=admin_token)

        self._answer_login_result(username, participation, login_data)

    def _answer_login_result(self, username: str,
                             participation: Participation | None,
                             login_data: bytes | None) -> None:
        """Answer the outcome of a credential check and keep the counters true.

        Split out of `post` so the success branches and the counter updates that
        belong to them are read as one thing.

        """
        if participation is None:
            self.captcha.record_failure(username, self.request.remote_ip)
            self.json({"error": "Login failed"}, 403)
        elif login_data is not None:
            # WHY record_success here and in the branch below: whoever ends up
            # authenticated has proven they are not guessing, so the failures
            # behind this account and address are dropped and a mistyped
            # password cannot accumulate into a lockout.
            self.captcha.record_success(username, self.request.remote_ip)
            cookie_name = self.contest.name + "_login"
            self.json({"login_data": self.create_signed_value(
                cookie_name, login_data).decode()})
        else:
            # WHY cleared even though no login data is issued: validate_login
            # returns (participation, None) when the contest allows IP
            # autologin instead of password authentication, which is a success.
            # The client is already authenticated by address and holds no
            # password worth counting, so the counters have to go or the
            # failures of an earlier attempt keep the lockout armed forever.
            self.captcha.record_success(username, self.request.remote_ip)
            self.json({})

    def _may_examine_password(self, username: str, admin_token: str) -> bool:
        """Return whether this attempt may reach the password check.

        The captcha gate and the lockout gate in the order they have to run in,
        so that neither layer is accidentally moved past the credential check.

        """
        # WHY a token is exempt from the challenge as well as from the lockout
        # below: a script, a client or a WAF authenticating with an admin token
        # is not guessing, and this endpoint is JSON with no page to host an
        # interactive challenge, so demanding one would reproduce exactly the
        # unsatisfiable gate the contest form had. The token is still validated
        # afterwards by validate_login, so one that turns out to be invalid
        # fails as an ordinary rejected login.
        captcha_demanded = admin_token == "" and self.captcha.is_required(
            username, self.request.remote_ip)

        # WHY the captcha comes first: a wrong or forged answer must not reach
        # the password check at all, or the layer only slows the part of the
        # attempt that costs the attacker nothing. is_required() is the single
        # authority on whether a captcha is demanded, so an attempt below the
        # threshold never reaches the provider at all.
        if captcha_demanded and not self.captcha.verify(
                username, self.request.remote_ip, extract_token(self)):
            self.captcha.record_failure(username, self.request.remote_ip)
            self.json({"error": "Login failed"}, 403)
            return False

        # WHY the lockout comes after it and before validate_login: the password
        # of a locked-out account is the work the lockout exists to skip. A
        # token is exempted: an administrator impersonating a contestant proves
        # who they are with the token and not with the contestant's password,
        # so that contestant's own failures must not lock the administrator out
        # of an account they are acting on. The check still holds against a
        # token that turns out to be invalid, because validate_login then
        # fails it as an ordinary rejected login.
        if admin_token == "" and self.captcha.is_locked(
                username, self.request.remote_ip):
            # WHY not recorded as another failure: the count is already at the
            # threshold and is never reset while the window is live, so
            # incrementing it here would slide the window forward on every
            # attempt and turn a lockout someone waits out into one that never
            # ends for an address that keeps trying.
            logger.info("Login refused, account or IP %r locked out from IP %s.",
                        username, self.request.remote_ip)
            self.json({
                "error": "Account or IP address locked out after too many "
                         "failed attempts. Retry later.",
            }, LOGIN_LOCKED_STATUS)
            return False

        return True

    def _answer_already_logged_in(self, username: str) -> None:
        """Answer a login request from a client that is already authenticated.

        An attempt to switch to a different account from a session that is
        already authenticated is refused; anything else reports back the
        credential the session currently holds, so a client that lost the
        response of its previous login can recover it without another one.

        """
        current_user = self.get_current_user()
        if username != "" and current_user.user.username != username:
            self.json(
                {"error": f"Logged in as {current_user.user.username} but trying to login as {username}"}, 400)
            return
        cookie_name = self.contest.name + "_login"
        cookie = self.get_secure_cookie(cookie_name)
        self.json({"login_data": self.request.headers.get(
            "X-CMS-Authorization",
            cookie if cookie is not None else "Already-Logged-In")})

    def check_xsrf_cookie(self):
        pass


class ApiTaskListHandler(ApiContestHandler):
    """Handler to list all tasks and their statements.

    """
    @api_login_required
    @actual_phase_required(0, 3)
    @multi_contest
    def get(self):
        contest = self.contest
        tasks = []
        for task in contest.tasks:
            name = task.name
            statements = [s for s in task.statements]
            sub_format = task.submission_format
            tasks.append({"name": name,
                          "statements": statements,
                          "submission_format": sub_format})
        self.json({"tasks": tasks})


class ApiSubmitHandler(ApiContestHandler):
    """Handles the received submissions.

    """
    @api_login_required
    @actual_phase_required(0, 3)
    @multi_contest
    def post(self, task_name: str):
        task = self.get_task(task_name)
        if task is None:
            self.json({"error": "Task not found"}, 404)
            return

        # Only set the official bit when the user can compete and we are not in
        # analysis mode.
        official = self.r_params["actual_phase"] == 0

        # If the submission is performed by the administrator acting on behalf
        # of a contestant, allow overriding.
        if self.impersonated_by_admin:
            try:
                official = self.get_boolean_argument('override_official', official)
                override_max_number = self.get_boolean_argument('override_max_number', False)
                override_min_interval = self.get_boolean_argument('override_min_interval', False)
            except ValueError as err:
                self.json({"error": str(err)}, 400)
                return
        else:
            override_max_number = False
            override_min_interval = False

        try:
            submission = accept_submission(
                self.sql_session, self.service.file_cacher, self.current_user,
                task, self.timestamp, self.request.files,
                self.get_argument("language", None), official,
                override_max_number=override_max_number,
                override_min_interval=override_min_interval,
            )
            self.sql_session.commit()
        except UnacceptableSubmission as e:
            logger.info("API submission rejected: `%s' - `%s'",
                        e.subject, e.formatted_text)
            self.json({"error": e.subject, "details": e.formatted_text}, 422)
        else:
            logger.info(
                f'API submission accepted: Submission ID {submission.id}')
            self.service.evaluation_service.new_submission(
                submission_id=submission.id)
            self.json({'id': str(submission.opaque_id)})


class ApiSubmissionListHandler(ApiContestHandler):
    """Retrieves the list of submissions on a task.

    """
    @api_login_required
    @actual_phase_required(0, 3)
    @multi_contest
    def get(self, task_name: str):
        task = self.get_task(task_name)
        if task is None:
            self.json({"error": "Not found"}, 404)
            return
        submissions: list[Submission] = (
            self.sql_session.query(Submission)
            .filter(Submission.participation == self.current_user)
            .filter(Submission.task == task)
            .all()
        )
        self.json({'list': [{"id": str(s.opaque_id)} for s in submissions]})
