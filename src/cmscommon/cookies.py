#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2014 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2018 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2012-2014 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2013 Bernard Blackham <bernard@largestprime.net>
# Copyright © 2014 Artem Iglikov <artem@iglikov.ru>
# Copyright © 2014 Fabian Gundlach <320pointsguy@gmail.com>
# Copyright © 2015-2018 William Di Luigi <williamdiluigi@gmail.com>
# Copyright © 2021 Grace Hawkins <amoomajid99@gmail.com>
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

"""Security attributes shared by the contest and classic admin cookies."""

import os
from typing import Literal, TypedDict


_INSECURE_VALUES = {"0", "false", "no", "off"}


class SessionCookieAttributes(TypedDict):
    secure: bool
    httponly: Literal[True]
    samesite: Literal["Lax"]


def cookie_secure() -> bool:
    """Secure by default; only an explicit false-like value enables local HTTP."""
    value = os.environ.get("COOKIE_SECURE", "true").strip().lower()
    return value not in _INSECURE_VALUES


def session_cookie_attributes() -> SessionCookieAttributes:
    """Return the attributes every authentication cookie must carry."""
    return {
        "secure": cookie_secure(),
        "httponly": True,
        "samesite": "Lax",
    }
