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
from cmscommon.datetime import make_datetime
from .admin_security import (
    SELF_MODIFIABLE_FIELDS as ADMIN_SELF_MODIFIABLE_FIELDS,
    admin_attrs,
    build_admin,
    caller_outranks_target,
    commit_admin_delete,
    commit_admin_update,
    commit_new_admin,
    deny_superset,
    is_superadmin,
    read_posted_attrs,
    refuse_password_without_permission,
    restrict_to_self_modifiable,
    would_remove_last_superadmin,
)
from .base import (
    BaseHandler,
    SimpleHandler,
    invalidate_permission_cache,
    require_permission,
)


logger = logging.getLogger(__name__)


class AddAdminHandler(SimpleHandler("add_admin.html", permission="admin:create")):
    @require_permission("admin:create")
    def post(self):
        fallback_page = self.url("admins", "add")

        try:
            attrs = admin_attrs(self)
            group_ids = attrs.pop("admin_groups", [])
            assert attrs.get("authentication") is not None, (
                "Empty password not permitted."
            )
            admin = build_admin(attrs, group_ids)
        except Exception as error:
            self.service.add_notification(
                make_datetime(), "Invalid field(s)", repr(error)
            )
            self.redirect(fallback_page)
            return

        if commit_new_admin(self, admin):
            self.redirect(self.url("admins"))
        else:
            self.redirect(fallback_page)


class AdminsHandler(BaseHandler):
    """Page to see all admins."""

    @require_permission("admin:list")
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

    SELF_MODIFIABLE_FIELDS = ADMIN_SELF_MODIFIABLE_FIELDS

    @require_permission(BaseHandler.AUTHENTICATED)
    def get(self, admin_id: str):
        admin = self.safe_get_item(Admin, admin_id)

        self.r_params = self.render_params()
        self.r_params["admin_being_edited"] = admin
        self.render("admin.html", **self.r_params)

    @require_permission(
        ("admin:update", "admin:password:update"), self_allowed=True)
    def post(self, admin_id: str):
        admin = self.safe_get_item(Admin, admin_id)
        verdict = caller_outranks_target(self, admin, allow_self=True, action="admin")
        if verdict is not True:
            deny_superset(self, admin_id, verdict)
            return

        new_attrs = read_posted_attrs(self, admin_id)
        if new_attrs is None:
            return

        has_password_update = self.current_user.has_permission("admin:password:update")
        if refuse_password_without_permission(
                self, new_attrs, admin_id, has_password_update):
            return

        group_ids = new_attrs.pop("admin_groups", [])
        restrict_to_self_modifiable(self, admin, new_attrs, has_password_update)
        enabled_after = new_attrs.get("enabled", admin.enabled)
        if would_remove_last_superadmin(self, admin, group_ids, enabled_after):
            self.service.add_notification(
                make_datetime(), "Operation denied",
                "Cannot remove the last superadmin."
            )
            self.redirect(self.url("admin", admin_id))
            return

        if commit_admin_update(self, admin_id, new_attrs, group_ids):
            invalidate_permission_cache(int(admin.id))
            logger.info("Admin %s updated.", admin.id)
            self.redirect(self.url("admins"))
        else:
            self.redirect(self.url("admin", admin_id))

    @require_permission("admin:delete")
    def delete(self, admin_id: str):
        admin = self.safe_get_item(Admin, admin_id)
        verdict = caller_outranks_target(self, admin, allow_self=False, action="delete")
        if verdict is not True:
            self.write("Cannot mutate an admin with permissions you do not hold."
                       if verdict is False else "Permission check failed.")
            return

        if is_superadmin(admin):
            superadmin_gid = (
                self.sql_session.query(Group.id)
                .filter(Group.name == 'Superadmin')
                .scalar()
            )
            others = (
                self.sql_session.query(Admin)
                .join(AdminGroup, AdminGroup.admin_id == Admin.id)
                .filter(AdminGroup.group_id == superadmin_gid)
                .filter(Admin.enabled.is_(True))
                .filter(Admin.id != admin.id)
                .count()
            )
            if others == 0:
                self.write("Cannot delete the last superadmin.")
                return

        if commit_admin_delete(self, admin_id):
            invalidate_permission_cache(int(admin.id))

        self.write("../admins")
