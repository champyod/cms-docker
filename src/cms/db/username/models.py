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

"""ORM models for the contestant display-username feature."""

from datetime import datetime

from sqlalchemy.orm import relationship
from sqlalchemy.schema import Column, ForeignKey, UniqueConstraint
from sqlalchemy.types import DateTime, Enum, Integer, Unicode

from ..admin import Admin
from ..base import Base
from ..contest import Contest
from ..types import Codename
from ..user import Participation, User

POLICY_SCOPES = ("contest", "user", "group")


class ContestantGroup(Base):
    """A group of contestants that one policy can cover."""

    __tablename__ = "contestant_groups"

    id: int = Column(Integer, primary_key=True)
    name: str = Column(Unicode, nullable=False, unique=True)
    description: str | None = Column(Unicode, nullable=True)
    created_at: datetime = Column(
        DateTime, nullable=False, server_default="now()")

    memberships: list["ContestantGroupMembership"] = relationship(
        "ContestantGroupMembership",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="group")


class ContestantGroupMembership(Base):
    """A contestant's membership in a contestant group."""

    __tablename__ = "contestant_group_memberships"

    id: int = Column(Integer, primary_key=True)
    created_at: datetime = Column(
        DateTime, nullable=False, server_default="now()")

    user_id: int = Column(
        Integer,
        ForeignKey(User.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    user: User = relationship(User)

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
    """An allow/deny policy for the feature at one scope; absence means unset."""

    __tablename__ = "username_policies"

    id: int = Column(Integer, primary_key=True)
    scope: str = Column(
        Enum(*POLICY_SCOPES, name="username_policy_scope"),
        nullable=False)
    scope_id: int = Column(Integer, nullable=False, index=True)
    policy: str = Column(
        Enum("allow", "deny", name="username_policy"),
        nullable=False)
    updated_at: datetime = Column(
        DateTime, nullable=False, server_default="now()")
    # Null when the admin that made the change has since been deleted.
    updated_by: int | None = Column(
        Integer,
        ForeignKey(Admin.id, onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
        index=True)
    updater: Admin | None = relationship(Admin)

    __table_args__ = (UniqueConstraint("scope", "scope_id"),)


class ContestUsername(Base):
    """A user's display username in one contest."""

    __tablename__ = "contest_usernames"

    id: int = Column(Integer, primary_key=True)
    username: str = Column(Codename, nullable=False)
    updated_at: datetime = Column(DateTime, nullable=False)
    # Null when the contestant set the alias themselves.
    updated_by_admin_id: int | None = Column(
        Integer,
        ForeignKey(Admin.id, onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
        index=True)
    updated_by_admin: Admin | None = relationship(Admin)

    participation_id: int = Column(
        Integer,
        ForeignKey(Participation.id,
                   onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        unique=True)
    participation: Participation = relationship(Participation)

    # Denormalized from the participation: enforces per-contest uniqueness and
    # looks aliases up by user without joining through the participation.
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
    """An append-only record of display-username changes."""

    __tablename__ = "contest_usernames_history"

    id: int = Column(Integer, primary_key=True)
    username: str | None = Column(Codename, nullable=True)
    set_at: datetime = Column(DateTime, nullable=False)
    # Null when the contestant made the change themselves.
    set_by_admin_id: int | None = Column(
        Integer,
        ForeignKey(Admin.id, onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,
        index=True)
    set_by_admin: Admin | None = relationship(Admin)

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
