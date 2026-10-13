#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026
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

"""Handler for the self-service display username in CWS."""

import re

import tornado.web

from cms.db import Admin, User
from cms.db.session import Session
from cms.db.username import (
    get_display_username, set_display_username,
    username_config_allowed)
from cms.server import multi_contest
from .contest import ContestHandler

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _is_login_username_taken(
        sql_session: Session, username: str) -> bool:
    return bool(
        sql_session.query(User).filter(User.username == username).count()
        or sql_session.query(Admin).filter(Admin.username == username).count())


class UsernameHandler(ContestHandler):
    """Show and change the display username for the running contest."""

    MAX_INPUT_LENGTH = 50

    @tornado.web.authenticated
    @multi_contest
    def get(self) -> None:
        self.r_params = self.render_params()
        user = self.current_user.user
        self.r_params["username_config_allowed"] = username_config_allowed(
            self.sql_session, self.contest.id, user.id)
        self.r_params["username"] = get_display_username(
            self.sql_session, self.contest.id, user.id)
        self.r_params["MAX_INPUT_LENGTH"] = self.MAX_INPUT_LENGTH
        self.render("username.html", **self.r_params)

    @tornado.web.authenticated
    @multi_contest
    def post(self) -> None:
        participation = self.current_user
        user = participation.user
        if not username_config_allowed(
                self.sql_session, self.contest.id, user.id):
            raise tornado.web.HTTPError(403)

        username = self._read_username()
        self._assert_username_available(username)
        try:
            set_display_username(
                self.sql_session, participation,
                username if username != "" else None,
                self.timestamp)
        except ValueError:
            raise tornado.web.HTTPError(409)

        self.sql_session.commit()
        self.redirect(self.contest_url("username"))

    def _read_username(self) -> str:
        username: str = self.get_argument("username", "").strip()
        if username == "":
            return username
        if not 1 <= len(username) <= self.MAX_INPUT_LENGTH:
            raise tornado.web.HTTPError(400)
        if USERNAME_PATTERN.match(username) is None:
            raise tornado.web.HTTPError(400)
        return username

    def _assert_username_available(self, username: str) -> None:
        # Sharing a handle with a login name would let a contestant borrow it.
        if username != "" and _is_login_username_taken(
                self.sql_session, username):
            raise tornado.web.HTTPError(400)
