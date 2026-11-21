#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2015-2018 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2016 Myungwoo Chun <mc.tamaki@gmail.com>
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

"""Admin-account form parsing and the cms_admin_account_security write path."""

import logging

from cms.db import Admin
from cms.db.permissions import AdminGroup, Group
from cms.db.session import Session
from cmscommon.crypto import hash_password
from cmscommon.datetime import make_datetime
from .base import BaseHandler, get_effective_permissions, is_effective_superset


logger = logging.getLogger(__name__)

SELF_MODIFIABLE_FIELDS = ("name", "username", "authentication")


def require_current_user(handler: BaseHandler) -> Admin:
    """Return the signed-in admin; the permission decorator guarantees one."""
    assert handler.current_user is not None
    return handler.current_user


def is_superadmin(admin: Admin) -> bool:
    return any(ag.group.name == 'Superadmin' for ag in admin.admin_groups)


def admin_attrs(handler: BaseHandler) -> dict:
    """Return the admin attributes read from the request form."""
    attrs = {}
    handler.get_string(attrs, "username", empty=None)
    handler.get_string(attrs, "name", empty=None)
    assert attrs.get("username") is not None, "No username specified."
    assert attrs.get("name") is not None, "No admin name specified."

    handler.get_string(attrs, "password", empty=None)
    password = attrs.pop("password", None)
    if password is not None:
        attrs["authentication"] = hash_password(password)

    attrs["admin_groups"] = [
        int(gid) for gid in handler.get_arguments("admin_groups")
    ]
    handler.get_bool(attrs, "enabled")
    return attrs


def _admin_group(group_id: int, admin_id: int | None = None) -> AdminGroup:
    """Build a membership row; Base.__init__ rejects foreign-key columns."""
    link = AdminGroup()
    link.group_id = group_id
    if admin_id is not None:
        link.admin_id = admin_id
    return link


def build_admin(attrs: dict, group_ids: list[int]) -> Admin:
    """Build a transient admin with its membership rows."""
    admin = Admin(**attrs)
    for group_id in group_ids:
        admin.admin_groups.append(_admin_group(group_id))
    return admin


def _replace_admin_groups(security_session: "Session", admin_id: int,
                          group_ids: list[int]) -> None:
    """Replace memberships with DELETE + INSERT; the role has no UPDATE there."""
    security_session.query(AdminGroup) \
        .filter(AdminGroup.admin_id == admin_id) \
        .delete(synchronize_session=False)
    for group_id in group_ids:
        security_session.add(_admin_group(group_id, admin_id))


def commit_new_admin(handler: BaseHandler, admin: Admin) -> bool:
    """Insert a new admin on the security session."""
    with handler.admin_security_session() as security_session:
        security_session.add(admin)
        return handler.try_commit_admin_security(security_session)


def commit_admin_update(handler: BaseHandler, admin_id: str, new_attrs: dict,
                        group_ids: list[int]) -> bool:
    """Apply an update on the security session, re-fetching the target first."""
    with handler.admin_security_session() as security_session:
        target = handler.safe_get_item(Admin, admin_id, session=security_session)
        target.set_attrs(new_attrs)
        if require_current_user(handler).has_permission("all:all"):
            _replace_admin_groups(security_session, target.id, group_ids)
        return handler.try_commit_admin_security(security_session)


def commit_admin_delete(handler: BaseHandler, admin_id: str) -> bool:
    """Delete an admin and its memberships on the security session."""
    with handler.admin_security_session() as security_session:
        target = handler.safe_get_item(Admin, admin_id, session=security_session)
        _replace_admin_groups(security_session, target.id, [])
        security_session.delete(target)
        return handler.try_commit_admin_security(security_session)


def read_posted_attrs(handler: BaseHandler, admin_id: str) -> dict | None:
    """Read the form; notify and redirect when it is invalid."""
    try:
        return admin_attrs(handler)
    except Exception as error:
        handler.service.add_notification(
            make_datetime(), "Invalid field(s)", repr(error))
        handler.redirect(handler.url("admin", admin_id))
        return None


def refuse_password_without_permission(handler: BaseHandler, new_attrs: dict,
                                       admin_id: str,
                                       has_password_update: bool) -> bool:
    """Notify and redirect when a password came without admin:password:update."""
    if "authentication" not in new_attrs or has_password_update:
        return False
    handler.service.add_notification(
        make_datetime(), "Operation denied",
        "Cannot change an admin password without holding admin:password:update.")
    handler.redirect(handler.url("admin", admin_id))
    return True


def deny_superset(handler: BaseHandler, admin_id: str,
                  verdict: bool | None) -> None:
    """Notify and return to the edit page after a refused superset check."""
    handler.service.add_notification(
        make_datetime(), "Operation denied",
        "Cannot mutate an admin with permissions you do not hold."
        if verdict is False else "Permission check failed.")
    handler.redirect(handler.url("admin", admin_id))


def caller_outranks_target(handler: BaseHandler, admin: Admin,
                           allow_self: bool, action: str) -> bool | None:
    """Return True to allow, False to deny, None when the check failed."""
    user = require_current_user(handler)
    if allow_self and str(admin.id) == str(user.id):
        return True
    try:
        caller_eff = get_effective_permissions(user.id, handler.sql_session)
        target_eff = get_effective_permissions(admin.id, handler.sql_session)
        return is_effective_superset(caller_eff, target_eff, handler.sql_session)
    except Exception:
        logger.error("Failed superset check for %s %s.", action, admin.id)
        return None


def restrict_to_self_modifiable(handler: BaseHandler, admin: Admin,
                                new_attrs: dict,
                                has_password_update: bool) -> None:
    """Drop fields the caller may not set on this target."""
    user = require_current_user(handler)
    if user.has_permission("all:all"):
        return
    for key in list(new_attrs):
        if key not in SELF_MODIFIABLE_FIELDS:
            del new_attrs[key]
    if not user.has_permission("admin:update") \
            and str(admin.id) != str(user.id):
        new_attrs.pop("name", None)
        new_attrs.pop("username", None)
    if not has_password_update:
        new_attrs.pop("authentication", None)


def would_remove_last_superadmin(handler: BaseHandler, admin: Admin,
                                 group_ids: list[int],
                                 enabled_after: bool) -> bool:
    """Return True when this update would leave no enabled superadmin."""
    if not require_current_user(handler).has_permission("all:all") \
            or not is_superadmin(admin):
        return False
    superadmin_gid = (
        handler.sql_session.query(Group.id)
        .filter(Group.name == 'Superadmin')
        .scalar()
    )
    will_be_super = superadmin_gid in group_ids if superadmin_gid else False
    if will_be_super and enabled_after:
        return False
    others = (
        handler.sql_session.query(Admin)
        .join(AdminGroup, AdminGroup.admin_id == Admin.id)
        .filter(AdminGroup.group_id == superadmin_gid)
        .filter(Admin.enabled.is_(True))
        .filter(Admin.id != admin.id)
        .count()
    )
    return others == 0
