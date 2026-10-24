#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2017 Luca Wehrstedt <luca.wehrstedt@gmail.com>
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

"""A class to update a dump created by CMS.

Used by DumpImporter and DumpUpdater.

This updater specifies the method contestant passwords are hashed with.

A version-27 dump stores the password verbatim, so this updater still *reads* a
raw password — that is the only place it exists. It must not write one back:
prefixing it with "plaintext:" would keep the secret readable in the imported
database and such rows no longer authenticate (the login path refuses the
plaintext method). The old value is therefore hashed here, and only the bcrypt
hash is written back into the dump.

"""

from cmscommon.crypto import hash_password


class Updater:

    def __init__(self, data):
        assert data["_version"] == 27
        self.objs = data

    def run(self):
        for k, v in self.objs.items():
            if k.startswith("_"):
                continue

            if v["_class"] == "User":
                v["password"] = hash_password(v["password"])

            if v["_class"] == "Participation" and v["password"] is not None:
                v["password"] = hash_password(v["password"])

        return self.objs
