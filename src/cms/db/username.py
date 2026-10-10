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

"""Contestant display username: groups, policies and aliases.

A contestant may configure a display username shown by the contest
web server and the rankings instead of their real name. The login
username is untouched. Whether the feature is enabled is resolved
per user with the precedence contest > user > group, and a deny on
any of the user's groups wins over an allow on another one.

"""

from datetime import datetime

from sqlalchemy.orm import relationship
from sqlalchemy.schema import Column, ForeignKey, UniqueConstraint
from sqlalchemy.types import DateTime, Enum, Integer, Unicode

from .admin import Admin
from .base import Base
from .contest import Contest
from .session import Session
from .types import Codename
from .user import Participation, User

# The scopes a username policy can be attached to, in decreasing
# order of precedence when resolving whether a user may configure
# their display username.
POLICY_SCOPES = ("contest", "user", "group")


class ContestantGroup(Base):
    """Class to store a group of contestants.

    A group is a way to bulk-configure the display username
    feature: a single policy on a group applies to all its
    members. Unlike the RBAC groups, which hold admin
    permissions, these groups hold contestants only.

    """

    __tablename__ = "contestant_groups"

    # Auto increment primary key.
    id: int = Column(Integer, primary_key=True)

    # Unique, human-readable name of the group.
    name: str = Column(Unicode, nullable=False, unique=True)

    # Human readable description of the group.
    description: str | None = Column(Unicode, nullable=True)

    # Time the group was created.
    created_at: datetime = Column(
        DateTime, nullable=False, server_default="now()")

    memberships: list["ContestantGroupMembership"] = relationship(
        "ContestantGroupMembership",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="group")


class ContestantGroupMembership(Base):
    """Class to store the membership of a contestant in a group."""

    __tablename__ = "contestant_group_memberships"

    # Auto increment primary key.
    id: int = Column(Integer, primary_key=True)

    # Time the membership was created.
    created_at: datetime = Column(
        DateTime, nullable=False, server_default="now()")

    # User (id and object) belonging to the group.
    user_id: int = Column(
        Integer,
        ForeignKey(User.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    user: User = relationship(User)

    # Group (id and object) the user belongs to.
    group_id: int = Column(
        Integer,
        ForeignKey(ContestantGroup.id,
                   onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    group: ContestantGroup = relationship(
        ContestantGroup, back_populates="memberships")

    __table_args__ = (UniqueConstraint("user_id", "group_id"),)


class UsernamePolicy(Base):
    """Class to store a policy for the display username feature.

    A policy row means "set" for its scope; its absence means
    "unset" and the resolution falls through to the next level.
    The scope column says what the row applies to: a contest, a
    single user, or a group (in which case it applies to all the
    group's members).

    """

    __tablename__ = "username_policies"

    # Auto increment primary key.
    id: int = Column(Integer, primary_key=True)

    # What the policy applies to: a contest, a user or a group.
    scope: str = Column(
        Enum(*POLICY_SCOPES, name="username_policy_scope"),
        nullable=False)

    # Id of the contest, user or group the policy applies to.
    scope_id: int = Column(Integer, nullable=False, index=True)

    # Whether the feature is allowed or denied in the scope.
    policy: str = Column(
        Enum("allow", "deny", name="username_policy"),
        nullable=False)

    # Time of the last change and the admin who made it (null if
    # the admin has been later deleted).
    updated_at: datetime = Column(
        DateTime, nullable=False, server_default="now()")
    updated_by: int | None = Column(
        Integer,
        ForeignKey(Admin.id, onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
        index=True)
    updater: Admin | None = relationship(Admin)

    __table_args__ = (UniqueConstraint("scope", "scope_id"),)


class ContestUsername(Base):
    """Class to store the current display username of a user in
    a contest.

    """

    __tablename__ = "contest_usernames"

    # Auto increment primary key.
    id: int = Column(Integer, primary_key=True)

    # The display username itself.
    username: str = Column(Codename, nullable=False)

    # Time of the last change and who made it: an admin (id), or
    # null if the contestant set it themselves.
    updated_at: datetime = Column(DateTime, nullable=False)
    updated_by_admin_id: int | None = Column(
        Integer,
        ForeignKey(Admin.id, onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
        index=True)
    updated_by_admin: Admin | None = relationship(Admin)

    # Participation (id and object) the username belongs to. One
    # participation owns at most one display username.
    participation_id: int = Column(
        Integer,
        ForeignKey(Participation.id,
                   onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        unique=True)
    participation: Participation = relationship(Participation)

    # Contest and user (ids), denormalized from the participation
    # to enforce per-contest uniqueness and to look aliases up by
    # user without joining through the participation.
    contest_id: int = Column(
        Integer,
        ForeignKey(Contest.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    contest: Contest = relationship(Contest)
    user_id: int = Column(
        Integer,
        ForeignKey(User.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    user: User = relationship(User)

    __table_args__ = (UniqueConstraint("contest_id", "username"),)


class ContestUsernameHistory(Base):
    """Class to store the history of the display username
    changes, for audit and dispute resolution.

    """

    __tablename__ = "contest_usernames_history"

    # Auto increment primary key.
    id: int = Column(Integer, primary_key=True)

    # Username that was set (null if the alias was removed).
    username: str | None = Column(Codename, nullable=True)

    # Time the change happened and the admin who made it (null if
    # the contestant made it themselves).
    set_at: datetime = Column(DateTime, nullable=False)
    set_by_admin_id: int | None = Column(
        Integer,
        ForeignKey(Admin.id, onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
        index=True)
    set_by_admin: Admin | None = relationship(Admin)

    # Contest and user (ids) the change belongs to.
    contest_id: int = Column(
        Integer,
        ForeignKey(Contest.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    user_id: int = Column(
        Integer,
        ForeignKey(User.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)


def resolve_username_config(
        sql_session: Session, contest_id: int,
        user_ids: list[int]) -> dict[int, bool]:
    """Resolve who may configure their display username.

    The policy is looked up with the precedence contest > user >
    group; when no policy is set anywhere the feature is denied.
    A deny on any of the user's groups wins over an allow on
    another one. At most three queries are issued, regardless of
    how many users are resolved.

    sql_session: the session to query with.
    contest_id: the contest the feature would be used in.
    user_ids: the users to resolve.

    return: a map from user id to whether the feature is enabled.

    """
    if not user_ids:
        return {}

    # A contest policy applies to every user in the contest.
    contest_policy: str | None = sql_session.query(
        UsernamePolicy.policy).filter(
            UsernamePolicy.scope == "contest").filter(
            UsernamePolicy.scope_id == contest_id).scalar()
    if contest_policy is not None:
        return {user_id: contest_policy == "allow"
                for user_id in user_ids}

    user_policies: dict[int, str] = dict(
        sql_session.query(UsernamePolicy.scope_id,
                          UsernamePolicy.policy).filter(
            UsernamePolicy.scope == "user").filter(
            UsernamePolicy.scope_id.in_(user_ids)).all())

    # Group policies: a deny on any of the user's groups wins
    # over an allow on another one.
    denied: set[int] = set()
    allowed: set[int] = set()
    memberships = sql_session.query(
        ContestantGroupMembership.user_id,
        UsernamePolicy.policy).join(
            UsernamePolicy,
            UsernamePolicy.scope_id
            == ContestantGroupMembership.group_id).filter(
        UsernamePolicy.scope == "group").filter(
        ContestantGroupMembership.user_id.in_(user_ids)).all()
    for user_id, policy in memberships:
        if policy == "deny":
            denied.add(user_id)
        else:
            allowed.add(user_id)

    resolved: dict[int, bool] = {}
    for user_id in user_ids:
        if user_id in user_policies:
            resolved[user_id] = user_policies[user_id] == "allow"
        elif user_id in denied:
            resolved[user_id] = False
        elif user_id in allowed:
            resolved[user_id] = True
        else:
            resolved[user_id] = False
    return resolved


def username_config_allowed(
        sql_session: Session, contest_id: int,
        user_id: int) -> bool:
    """Return whether a user may configure their display username
    in a contest.

    sql_session: the session to query with.
    contest_id: the contest the feature would be used in.
    user_id: the user to resolve.

    return: whether the feature is enabled for the user.

    """
    return resolve_username_config(
        sql_session, contest_id, [user_id]).get(user_id, False)


def get_display_usernames(
        sql_session: Session, contest_id: int,
        user_ids: list[int]) -> dict[int, str]:
    """Return the display usernames set in a contest, by user id.

    sql_session: the session to query with.
    contest_id: the contest the aliases belong to.
    user_ids: the users to look up.

    return: a map from user id to display username.

    """
    if not user_ids:
        return {}
    return dict(
        sql_session.query(ContestUsername.user_id,
                          ContestUsername.username).filter(
            ContestUsername.contest_id == contest_id).filter(
            ContestUsername.user_id.in_(user_ids)).all())


def get_display_username(
        sql_session: Session, contest_id: int,
        user_id: int) -> str | None:
    """Return a user's display username in a contest, if set.

    sql_session: the session to query with.
    contest_id: the contest the alias belongs to.
    user_id: the user to look up.

    return: the display username, or None when not set.

    """
    return get_display_usernames(
        sql_session, contest_id, [user_id]).get(user_id)


def get_display_name(
        sql_session: Session, contest_id: int,
        user: User) -> str:
    """Return the name to display for a user in a contest: their
    display username when the feature is enabled and set,
    otherwise their real name.

    sql_session: the session to query with.
    contest_id: the contest the name is shown in.
    user: the user the name belongs to.

    return: the display name.

    """
    if username_config_allowed(sql_session, contest_id, user.id):
        username = get_display_username(
            sql_session, contest_id, user.id)
        if username is not None:
            return username
    return "%s %s" % (user.first_name, user.last_name)


def set_display_username(
        sql_session: Session, participation: Participation,
        username: str | None, timestamp: datetime,
        admin: Admin | None = None) -> ContestUsername | None:
    """Set (or, with None, remove) a user's display username in
    a contest, recording the change in the history.

    The username must be unique within the contest. The caller is
    responsible for committing the session.

    sql_session: the session to use.
    participation: the participation the username belongs to.
    username: the new display username, or None to remove it.
    timestamp: the time of the change.
    admin: the admin making the change on the user's behalf, if
        any; null when the contestant sets it themselves.

    return: the updated record, or None when the username was
        removed.

    raise ValueError: if the username is already taken in the
        contest.

    """
    record: ContestUsername | None = sql_session.query(
        ContestUsername).filter(
            ContestUsername.participation == participation).first()

    if username is None:
        if record is not None:
            sql_session.add(ContestUsernameHistory(
                contest=participation.contest,
                user=participation.user,
                username=None, set_at=timestamp,
                set_by_admin=admin))
            sql_session.delete(record)
        return None

    if record is None or record.username != username:
        taken = sql_session.query(ContestUsername).filter(
            ContestUsername.contest == participation.contest).filter(
            ContestUsername.username == username).filter(
            ContestUsername.user != participation.user).first()
        if taken is not None:
            raise ValueError(
                "Display username already taken in this contest")
        history = ContestUsernameHistory(
            contest=participation.contest,
            user=participation.user,
            username=username, set_at=timestamp,
            set_by_admin=admin)
        if record is None:
            record = ContestUsername(
                participation=participation,
                contest=participation.contest,
                user=participation.user,
                username=username, updated_at=timestamp,
                updated_by_admin=admin)
            sql_session.add(record)
        else:
            record.username = username
            record.updated_at = timestamp
            record.updated_by_admin = admin
        sql_session.add(history)
    return record
