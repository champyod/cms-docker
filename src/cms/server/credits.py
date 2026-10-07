#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
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

"""Read the credits every web surface serves.

The credits file sits at the root of the checkout, outside the installed
Python package, so it is located from $CMS_CREDITS_FILE when the operator sets
it, and otherwise by walking up from this module rather than by a fixed number
of parent directories: the depth at which the package sits differs between a
checkout and the installed tree of a container image.
"""

import json
import os
from functools import lru_cache
from pathlib import Path


CREDITS_FILE_NAME = "credits.json"
CREDITS_FILE_ENV_VAR = "CMS_CREDITS_FILE"


class CreditsError(Exception):
    """The credits file is missing, unreadable or not valid JSON."""


def find_credits_file(start: Path | None = None) -> Path:
    """Return the path of the credits file.

    A path in $CMS_CREDITS_FILE wins when it names an existing file, because a
    container installs the package away from the checkout and the upward walk
    from the installed module would never reach the file.

    start: the directory the upward search begins from; it defaults to the
        directory holding this module.

    raise (CreditsError): if neither the configured path nor any directory
        above start holds the file. A page rendered from an empty credits list
        would be a licence compliance failure rather than a cosmetic one, so
        this never falls back to no data.

    """
    configured = os.environ.get(CREDITS_FILE_ENV_VAR)
    if configured is not None and Path(configured).is_file():
        return Path(configured)
    first = Path(start).resolve() if start is not None \
        else Path(__file__).resolve().parent
    searched = [first, *first.parents]
    for directory in searched:
        candidate = directory / CREDITS_FILE_NAME
        if candidate.is_file():
            return candidate
    raise CreditsError("%s not found: %s, searched %s" % (
        CREDITS_FILE_NAME,
        "%s=%s" % (CREDITS_FILE_ENV_VAR, configured) if configured is not None
        else "%s unset" % CREDITS_FILE_ENV_VAR,
        ", ".join(str(directory) for directory in searched)))


@lru_cache(maxsize=None)
def load_credits(start: Path | None = None) -> dict:
    """Return the parsed contents of the credits file.

    The result is cached because the file is a build artifact that cannot
    change under a running server, and a notice taken from it is rendered on
    every contest page.

    start: forwarded to find_credits_file().

    raise (CreditsError): if the file cannot be read, is not valid JSON, or
        does not hold a JSON object.

    """
    path = find_credits_file(start)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise CreditsError("Cannot read %s: %s" % (path, error))
    try:
        credits = json.loads(raw)
    except json.JSONDecodeError as error:
        raise CreditsError("%s is not valid JSON: %s" % (path, error))
    if not isinstance(credits, dict):
        raise CreditsError("%s must hold a JSON object" % path)
    return credits


def get_surface(name: str, start: Path | None = None) -> dict:
    """Return the credits of one named surface.

    name: the surface to return, such as "contest".
    start: forwarded to find_credits_file().

    raise (CreditsError): if the file declares no such surface.

    """
    credits = load_credits(start)
    surfaces = credits.get("surfaces")
    if not isinstance(surfaces, dict) or name not in surfaces:
        raise CreditsError("%s declares no %r surface" % (
            CREDITS_FILE_NAME, name))
    return surfaces[name]