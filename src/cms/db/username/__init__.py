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

"""Contestant display username: models, resolution and mutation."""

from .models import (POLICY_SCOPES, ContestUsername, ContestUsernameHistory,
                     ContestantGroup, ContestantGroupMembership,
                     UsernamePolicy)
from .resolution import (get_display_name, get_display_username,
                         get_display_usernames, resolve_username_config,
                         set_display_username, username_config_allowed)

__all__ = [
    "POLICY_SCOPES",
    "ContestantGroup",
    "ContestantGroupMembership",
    "UsernamePolicy",
    "ContestUsername",
    "ContestUsernameHistory",
    "resolve_username_config",
    "username_config_allowed",
    "get_display_usernames",
    "get_display_username",
    "get_display_name",
    "set_display_username",
]
