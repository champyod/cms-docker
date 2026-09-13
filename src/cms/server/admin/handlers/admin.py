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

"""Admin-related handlers for AWS."""

import logging

from cms.db import Admin
from cms.db.permissions import AdminGroup, Group
from cmscommon.crypto import hash_password
from cmscommon.datetime import make_datetime
from .base import (
    BaseHandler,
    SimpleHandler,
    get_effective_permissions,
    invalidate_permission_cache,
    is_effective_superset,
    require_permission,
)


logger = logging.getLogger(__name__)


def _is_superadmin(admin) -> bool:
    return any(ag.group.name == 'Superadmin' for ag in admin.admin_groups)


def _admin_attrs(handler: BaseHandler) -> dict:
    """Return a dictionary with the arguments to define an admin

    handler: the handler receiving the arguments.

    return: a dictionary with the arguments to define an admin,
        based on those passed to handler.

    """
    attrs = {}

    handler.get_string(attrs, "username", empty=None)
    handler.get_string(attrs, "name", empty=None)

    assert attrs.get("username") is not None, "No username specified."
    assert attrs.get("name") is not None, "No admin name specified."

    # Get the password and translate it to an authentication, if present.
    handler.get_string(attrs, "password", empty=None)
    if attrs["password"] is not None:
        attrs["authentication"] = hash_password(attrs["password"])
    del attrs["password"]

    attrs["admin_groups"] = [
        int(gid) for gid in handler.get_arguments("admin_groups")
    ]

    handler.get_bool(attrs, "enabled")

    return attrs


class AddAdminHandler(SimpleHandler("add_admin.html", permission="admin:create")):
    @require_permission("admin:create")
    def post(self):
        fallback_page = self.url("admins", "add")

        try:
            attrs = _admin_attrs(self)
            group_ids = attrs.pop("admin_groups", [])
            assert attrs.get("authentication") is not None, (
                "Empty password not permitted."
            )

            admin = Admin(**attrs)
            for gid in group_ids:
                admin.admin_groups.append(AdminGroup(group_id=gid))
            self.sql_session.add(admin)

        except Exception as error:
            self.service.add_notification(
                make_datetime(), "Invalid field(s)", repr(error)
            )
            self.redirect(fallback_page)
            return

        if self.try_commit():
            self.redirect(self.url("admins"))
        else:
            self.redirect(fallback_page)


class AdminsHandler(BaseHandler):
    """Page to see all admins."""

    @require_permission(BaseHandler.AUTHENTICATED)
    def get(self):
        self.r_params = self.render_params()
        self.r_params["admins"] = (
            self.sql_session.query(Admin)
            .order_by(Admin.enabled.desc())
            .order_by(Admin.username)
            .all()
        )
        self.render("admins.html", **self.r_params)


class AdminHandler(BaseHandler):
    """Admin handler, with a POST method to edit the admin."""

    # Fields that an admin can change themself, regardless of the
    # permission bits.
    SELF_MODIFIABLE_FIELDS = [
        "name",
        "username",
        "authentication",
    ]

    @require_permission(BaseHandler.AUTHENTICATED)
    def get(self, admin_id: str):
        admin = self.safe_get_item(Admin, admin_id)

        self.r_params = self.render_params()
        self.r_params["admin_being_edited"] = admin
        self.render("admin.html", **self.r_params)

    @require_permission("admin:update", self_allowed=True)
    def post(self, admin_id: str):
        admin = self.safe_get_item(Admin, admin_id)
        # WHY: password mutation must respect target superset — deny if target
        # holds permissions the caller lacks.
        if str(admin.id) != str(self.current_user.id):
            try:
                caller_eff = get_effective_permissions(
                    self.current_user.id, self.sql_session)
                target_eff = get_effective_permissions(
                    admin.id, self.sql_session)
                if not is_effective_superset(
                    caller_eff, target_eff, self.sql_session):
                    self.service.add_notification(
                        make_datetime(), "Operation denied",
                        "Cannot mutate an admin with permissions you do not hold.")
                    self.redirect(self.url("admin", admin_id))
                    return
            except Exception:
                logger.error("Failed superset check for admin %s.", admin_id)
                self.service.add_notification(
                    make_datetime(), "Operation denied",
                    "Permission check failed.")
                self.redirect(self.url("admin", admin_id))
                return

        try:
            new_attrs = _admin_attrs(self)

        except Exception as error:
            self.service.add_notification(
                make_datetime(), "Invalid field(s)", repr(error)
            )
            self.redirect(self.url("admin", admin_id))
            return

        # If the admin is allowed here because they are editing their own
        # details, they can only change a subset of the fields.
        group_ids = new_attrs.pop("admin_groups", [])
        if not self.current_user.has_permission("all:all"):
            for key in list(new_attrs.keys()):
                if key not in AdminHandler.SELF_MODIFIABLE_FIELDS:
                    del new_attrs[key]
        admin.set_attrs(new_attrs)

        if self.current_user.has_permission("all:all"):
            superadmin_gid = (
                self.sql_session.query(Group.id)
                .filter(Group.name == 'Superadmin')
                .scalar()
            )
            if _is_superadmin(admin):
                will_be_super = (
                    superadmin_gid in group_ids
                    if superadmin_gid else False
                )
                if not will_be_super or not admin.enabled:
                    others = (
                        self.sql_session.query(Admin)
                        .join(AdminGroup,
                              AdminGroup.admin_id == Admin.id)
                        .filter(AdminGroup.group_id == superadmin_gid)
                        .filter(Admin.enabled.is_(True))
                        .filter(Admin.id != admin.id)
                        .count()
                    )
                    if others == 0:
                        self.service.add_notification(
                            make_datetime(), "Operation denied",
                            "Cannot remove the last superadmin."
                        )
                        self.redirect(self.url("admin", admin_id))
                        return
            admin.admin_groups = [
                AdminGroup(group_id=gid) for gid in group_ids
            ]

        if self.try_commit():
            invalidate_permission_cache(int(admin.id))
            logger.info("Admin %s updated.", admin.id)
            self.redirect(self.url("admins"))
        else:
            self.redirect(self.url("admin", admin_id))

    @require_permission("admin:delete")
    def delete(self, admin_id: str):
        admin = self.safe_get_item(Admin, admin_id)
        try:
            caller_eff = get_effective_permissions(
                self.current_user.id, self.sql_session)
            target_eff = get_effective_permissions(
                admin.id, self.sql_session)
            if not is_effective_superset(
                caller_eff, target_eff, self.sql_session):
                self.write("Cannot mutate an admin with permissions you do not hold.")
                return
        except Exception:
            logger.error("Failed superset check for delete %s.", admin_id)
            self.write("Permission check failed.")
            return

        if _is_superadmin(admin):
            superadmin_gid = (
                self.sql_session.query(Group.id)
                .filter(Group.name == 'Superadmin')
                .scalar()
            )
            others = (
                self.sql_session.query(Admin)
                .join(AdminGroup,
                      AdminGroup.admin_id == Admin.id)
                .filter(AdminGroup.group_id == superadmin_gid)
                .filter(Admin.enabled.is_(True))
                .filter(Admin.id != admin.id)
                .count()
            )
            if others == 0:
                self.write("Cannot delete the last superadmin.")
                return

        deleted_id = int(admin.id)
        self.sql_session.delete(admin)
        if self.try_commit():
            invalidate_permission_cache(deleted_id)

        # Page to redirect to.
        self.write("../admins")
