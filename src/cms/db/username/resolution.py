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

"""Resolution and mutation of contestant display usernames."""

from datetime import datetime

from ..admin import Admin
from ..session import Session
from ..user import Participation, User
from .models import (ContestUsername, ContestUsernameHistory,
                     ContestantGroupMembership, UsernamePolicy)


def _contest_policy(sql_session: Session, contest_id: int) -> str | None:
    return sql_session.query(UsernamePolicy.policy).filter(
        UsernamePolicy.scope == "contest").filter(
        UsernamePolicy.scope_id == contest_id).scalar()


def _user_policies(
        sql_session: Session, user_ids: list[int]) -> dict[int, str]:
    return dict(
        sql_session.query(
            UsernamePolicy.scope_id, UsernamePolicy.policy).filter(
            UsernamePolicy.scope == "user").filter(
            UsernamePolicy.scope_id.in_(user_ids)).all())


def _group_verdicts(
        sql_session: Session,
        user_ids: list[int]) -> tuple[set[int], set[int]]:
    denied: set[int] = set()
    allowed: set[int] = set()
    rows = sql_session.query(
        ContestantGroupMembership.user_id, UsernamePolicy.policy).join(
            UsernamePolicy,
            UsernamePolicy.scope_id
            == ContestantGroupMembership.group_id).filter(
        UsernamePolicy.scope == "group").filter(
        ContestantGroupMembership.user_id.in_(user_ids)).all()
    for user_id, policy in rows:
        (denied if policy == "deny" else allowed).add(user_id)
    return denied, allowed


def _resolve_one(
        user_id: int, user_policies: dict[int, str],
        denied: set[int], allowed: set[int]) -> bool:
    if user_id in user_policies:
        return user_policies[user_id] == "allow"
    if user_id in denied:
        return False
    return user_id in allowed


def resolve_username_config(
        sql_session: Session, contest_id: int,
        user_ids: list[int]) -> dict[int, bool]:
    """Return, per user, whether they may configure a display username.

    Precedence is contest > user > group; a deny on any of a user's groups
    wins over an allow, and with no policy anywhere the feature is denied.
    """
    if not user_ids:
        return {}

    contest_policy = _contest_policy(sql_session, contest_id)
    if contest_policy is not None:
        return {user_id: contest_policy == "allow" for user_id in user_ids}

    user_policies = _user_policies(sql_session, user_ids)
    denied, allowed = _group_verdicts(sql_session, user_ids)
    return {
        user_id: _resolve_one(user_id, user_policies, denied, allowed)
        for user_id in user_ids}


def username_config_allowed(
        sql_session: Session, contest_id: int,
        user_id: int) -> bool:
    """Return whether a user may configure a display username in a contest."""
    return resolve_username_config(
        sql_session, contest_id, [user_id]).get(user_id, False)


def get_display_usernames(
        sql_session: Session, contest_id: int,
        user_ids: list[int]) -> dict[int, str]:
    """Return the display usernames set in a contest, keyed by user id."""
    if not user_ids:
        return {}
    return dict(
        sql_session.query(
            ContestUsername.user_id, ContestUsername.username).filter(
            ContestUsername.contest_id == contest_id).filter(
            ContestUsername.user_id.in_(user_ids)).all())


def get_display_username(
        sql_session: Session, contest_id: int,
        user_id: int) -> str | None:
    """Return a user's display username in a contest, or None when unset."""
    return get_display_usernames(
        sql_session, contest_id, [user_id]).get(user_id)


def get_display_name(
        sql_session: Session, contest_id: int,
        user: User) -> str:
    """Return the name to show: the alias when enabled and set, else the real name."""
    if username_config_allowed(sql_session, contest_id, user.id):
        username = get_display_username(sql_session, contest_id, user.id)
        if username is not None:
            return username
    return "%s %s" % (user.first_name, user.last_name)


def _find_record(
        sql_session: Session,
        participation: Participation) -> ContestUsername | None:
    return sql_session.query(ContestUsername).filter(
        ContestUsername.participation == participation).first()


def _assert_username_free(
        sql_session: Session, participation: Participation,
        username: str) -> None:
    taken = sql_session.query(ContestUsername).filter(
        ContestUsername.contest == participation.contest).filter(
        ContestUsername.username == username).filter(
        ContestUsername.user != participation.user).first()
    if taken is not None:
        raise ValueError("Display username already taken in this contest")


def _append_history(
        sql_session: Session, participation: Participation,
        username: str | None, timestamp: datetime,
        admin: Admin | None) -> None:
    sql_session.add(ContestUsernameHistory(
        contest=participation.contest,
        user=participation.user,
        username=username, set_at=timestamp,
        set_by_admin=admin))


def _create_username(
        sql_session: Session, participation: Participation,
        username: str, timestamp: datetime,
        admin: Admin | None) -> ContestUsername:
    record = ContestUsername(
        participation=participation,
        contest=participation.contest,
        user=participation.user,
        username=username, updated_at=timestamp,
        updated_by_admin=admin)
    sql_session.add(record)
    return record


def _update_username(
        record: ContestUsername, username: str,
        timestamp: datetime, admin: Admin | None) -> None:
    record.username = username
    record.updated_at = timestamp
    record.updated_by_admin = admin


def set_display_username(
        sql_session: Session, participation: Participation,
        username: str | None, timestamp: datetime,
        admin: Admin | None = None) -> ContestUsername | None:
    """Set (or, with None, remove) a display username, recording the history.

    The username must be unique within the contest; the caller commits.
    """
    record = _find_record(sql_session, participation)

    if username is None:
        if record is not None:
            _append_history(sql_session, participation, None, timestamp, admin)
            sql_session.delete(record)
        return None

    if record is not None and record.username == username:
        return record

    _assert_username_free(sql_session, participation, username)
    _append_history(sql_session, participation, username, timestamp, admin)
    if record is None:
        record = _create_username(
            sql_session, participation, username, timestamp, admin)
    else:
        _update_username(record, username, timestamp, admin)
    return record
