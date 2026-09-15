#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2013 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2013 Stefano Maggiolo <s.maggiolo@gmail.com>
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

from . import metadata

# WHY: the 6 RBAC tables are Prisma-owned; cmsInitDB must not create them
# or fresh installs collide with the migration history and prod never
# receives them via migrations.
_RBAC_TABLES = frozenset({
    "permissions",
    "groups",
    "group_permissions",
    "admin_groups",
    "admin_permission_overrides",
    "audit_log",
})


def init_db() -> bool:
    """Initialize the database.

    return: True if successful.

    """
    # WHY: restrict create_all to CMS-owned tables; RBAC tables are created
    # by Prisma migrations (see src/cms/db/__init__.py import comment).
    metadata.create_all(
        tables=[t for t in metadata.tables.values() if t.name not in _RBAC_TABLES]
    )

    return True
