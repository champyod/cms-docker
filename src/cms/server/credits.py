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
Python package, so it is located by walking up from this module rather than by
a fixed number of parent directories: the depth at which the package sits
differs between a checkout and the installed tree of a container image.
$CMS_CREDITS_FILE names the file where that walk cannot reach one.

An explicit start is an instruction from the caller about where its file is,
so it outranks the variable; the variable is the operator's override and is
consulted by the callers that pass no start, all of which in production do.
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

    An explicit start outranks $CMS_CREDITS_FILE: it names the tree the caller
    means, so a file found above it wins over an operator default that was set
    for a different tree. The variable is the fallback for that search, and it
    is the only source consulted first where no start is given, because a
    container installs the package away from the checkout and the walk from the
    installed module never reaches the file.

    start: the directory the upward search begins from; when it is None the
        search begins at the directory holding this module and
        $CMS_CREDITS_FILE is tried first.

    raise (CreditsError): if neither the configured path nor any directory
        above start holds the file. A page rendered from an empty credits list
        would be a licence compliance failure rather than a cosmetic one, so
        this never falls back to no data.

    """
    return _resolve_credits_file(start, os.environ.get(CREDITS_FILE_ENV_VAR))


def _resolve_credits_file(start: Path | None, configured: str | None) -> Path:
    """Return the path of the credits file for a given value of the variable.

    configured: the value $CMS_CREDITS_FILE holds, or None when it is unset;
        passed in rather than read here so that the resolution is a function of
        its arguments alone and load_credits() can cache on them.
    """
    if start is None and configured is not None \
            and Path(configured).is_file():
        return Path(configured)
    first = Path(start).resolve() if start is not None \
        else Path(__file__).resolve().parent
    searched = [first, *first.parents]
    for directory in searched:
        candidate = directory / CREDITS_FILE_NAME
        if candidate.is_file():
            return candidate
    if start is not None and configured is not None \
            and Path(configured).is_file():
        return Path(configured)
    raise CreditsError("%s not found: %s, searched %s" % (
        CREDITS_FILE_NAME,
        "%s=%s" % (CREDITS_FILE_ENV_VAR, configured) if configured is not None
        else "%s unset" % CREDITS_FILE_ENV_VAR,
        ", ".join(str(directory) for directory in searched)))


def load_credits(start: Path | None = None) -> dict:
    """Return the parsed contents of the credits file.

    The result is cached because the file is a build artifact that cannot
    change under a running server, and a notice taken from it is rendered on
    every contest page. The cache is keyed on the value of $CMS_CREDITS_FILE as
    well as on start, because that variable is an input of the resolution and
    a key of start alone would serve one tree's credits for another's.

    start: forwarded to find_credits_file().

    raise (CreditsError): if the file cannot be read, is not valid JSON, or
        does not hold a JSON object.

    """
    return _load_credits(start, os.environ.get(CREDITS_FILE_ENV_VAR))


@lru_cache(maxsize=None)
def _load_credits(start: Path | None, configured: str | None) -> dict:
    path = _resolve_credits_file(start, configured)
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