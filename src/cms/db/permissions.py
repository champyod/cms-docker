#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2025
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

"""Group-based permission models for SQLAlchemy."""

from sqlalchemy.schema import Column, ForeignKey, UniqueConstraint
from sqlalchemy.types import Boolean, Integer, Unicode, DateTime, BigInteger
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from .base import Base


class Permission(Base):
    __tablename__ = "permissions"

    id: int = Column(Integer, primary_key=True)
    key: str = Column(Unicode, nullable=False, unique=True)
    module: str = Column(Unicode, nullable=False)
    verb: str = Column(Unicode, nullable=False)
    description: str | None = Column(Unicode, nullable=True)

    group_permissions: list["GroupPermission"] = relationship(
        "GroupPermission",
        back_populates="permission")
    admin_permission_overrides: list["AdminPermissionOverride"] = relationship(
        "AdminPermissionOverride",
        back_populates="permission")


class Group(Base):
    __tablename__ = "groups"

    id: int = Column(Integer, primary_key=True)
    name: str = Column(Unicode, nullable=False, unique=True)
    description: str | None = Column(Unicode, nullable=True)
    is_seeded: bool = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, server_default="now()")

    group_permissions: list["GroupPermission"] = relationship(
        "GroupPermission",
        back_populates="group",
        cascade="all, delete-orphan",
        passive_deletes=True)
    admin_groups: list["AdminGroup"] = relationship(
        "AdminGroup",
        back_populates="group",
        cascade="all, delete-orphan",
        passive_deletes=True)


class GroupPermission(Base):
    __tablename__ = "group_permissions"

    id: int = Column(Integer, primary_key=True)
    group_id: int = Column(
        Integer,
        ForeignKey("groups.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False)
    permission_id: int = Column(
        Integer,
        ForeignKey("permissions.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False)

    group: Group = relationship(Group, back_populates="group_permissions")
    permission: Permission = relationship(Permission, back_populates="group_permissions")

    __table_args__ = (UniqueConstraint("group_id", "permission_id"),)


class AdminGroup(Base):
    __tablename__ = "admin_groups"

    id: int = Column(Integer, primary_key=True)
    admin_id: int = Column(
        Integer,
        ForeignKey("admins.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False)
    group_id: int = Column(
        Integer,
        ForeignKey("groups.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False)

    group: Group = relationship(Group, back_populates="admin_groups")

    __table_args__ = (UniqueConstraint("admin_id", "group_id"),)


class AdminPermissionOverride(Base):
    __tablename__ = "admin_permission_overrides"

    id: int = Column(Integer, primary_key=True)
    admin_id: int = Column(
        Integer,
        ForeignKey("admins.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False)
    permission_id: int = Column(
        Integer,
        ForeignKey("permissions.id", onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False)
    effect: str = Column(Unicode, nullable=False)
    reason: str | None = Column(Unicode, nullable=True)

    permission: Permission = relationship(Permission, back_populates="admin_permission_overrides")

    __table_args__ = (UniqueConstraint("admin_id", "permission_id"),)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: int = Column(BigInteger, primary_key=True)
    # WHY: column is actor_id in the real table (admin-panel writes/reads
    # actor_id); admin_id was dead — CMS never instantiates AuditLog.
    actor_id: int | None = Column(
        Integer,
        ForeignKey("admins.id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True)
    timestamp = Column(DateTime, nullable=False, server_default="now()")
    verb: str = Column(Unicode, nullable=False)
    entity: str = Column(Unicode, nullable=False)
    entity_id: str | None = Column(Unicode, nullable=True)
    before_values = Column(JSONB, nullable=True)
    after_values = Column(JSONB, nullable=True)
    reason: str | None = Column(Unicode, nullable=True)
    ip: str | None = Column(Unicode, nullable=True)
    session_id: str | None = Column(Unicode, nullable=True)
    result: str = Column(Unicode, nullable=False)
    entry_hash: str | None = Column(Unicode, nullable=True)
    prev_hash: str | None = Column(Unicode, nullable=True)
