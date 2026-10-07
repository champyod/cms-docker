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

"""Cross-checks between credits.json and the files each surface ships.

Kept apart from the test cases so the schema rules stay readable and both
files stay within the project's size limit.
"""

import glob
import json
import re
from pathlib import Path
from urllib.parse import unquote

# WHY resolved from __file__: the checkout may be tested from any working
# directory, and a CWD-relative lookup would silently miss the file.
REPO_ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
CREDITS_PATH = REPO_ROOT / "credits.json"
PANEL_MANIFEST = REPO_ROOT / "admin-panel" / "package.json"

# WHY these roots: a surface may only credit files inside the tree it serves.
# Listing them per surface is what lets a path that belongs to one surface be
# rejected when it is filed under another. contest and admin each name
# cms/server/static/ as well, because both servers mount it as a common static
# root and both legitimately serve the same bundled jQuery from it.
SURFACE_ROOTS = {
    "contest": ("cms/server/contest/", "cms/server/static/"),
    "admin": ("cms/server/admin/", "cms/server/static/"),
    "ranking": ("cmsranking/",),
    "panel": ("admin-panel/",),
}

SURFACE_NAMES = tuple(SURFACE_ROOTS)

# WHY two bases: the Python services live under src/ while the panel is a
# sibling of it, so a credited path is written relative to whichever root
# contains it.
PATH_BASES = (SRC_ROOT, REPO_ROOT)

# Each surface's entry point, together with the static roots its web server
# mounts. The first root that contains the reference wins, mirroring the
# server's own static_files order.
SURFACE_ENTRY_POINTS = {
    "contest": {
        "entry_point": SRC_ROOT / "cms/server/contest/templates/base.html",
        "static_roots": [
            SRC_ROOT / "cms/server/static",
            SRC_ROOT / "cms/server/contest/static",
        ],
        "jinja_static": True,
    },
    "admin": {
        "entry_point": SRC_ROOT / "cms/server/admin/templates/base.html",
        "static_roots": [
            SRC_ROOT / "cms/server/static",
            SRC_ROOT / "cms/server/admin/static",
        ],
        "jinja_static": True,
    },
    "ranking": {
        "entry_point": SRC_ROOT / "cmsranking/static/Ranking.html",
        "static_roots": [SRC_ROOT / "cmsranking/static"],
        "jinja_static": False,
    },
}

# Matches the src/href attribute of a script or link tag. Only those two tags
# load a bundled asset; a plain anchor points at a route, not at a file.
REFERENCES = re.compile(
    r"""<(?:script|link)\b[^>]*?"""
    r"""\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')""",
    re.IGNORECASE,
)
# Jinja's url("static", "jq", "jquery-3.6.0.min.js") form: the path segments
# are the quoted arguments after the leading "static".
JINJA_STATIC_URL = re.compile(r"""url\(\s*"static"\s*,\s*([^)]*)\)""")
QUOTED = re.compile(r"""["']([^"']*)["']""")

ABSOLUTE_PREFIXES = ("http://", "https://", "//", "data:", "mailto:", "#")


def _is_absolute(reference: str) -> bool:
    return reference.startswith(ABSOLUTE_PREFIXES)


def _jinja_static_references(text: str) -> set[str]:
    """Static paths built by url("static", ...) inside a Jinja template."""
    return {
        "/".join(QUOTED.findall(match.group(1)))
        for match in JINJA_STATIC_URL.finditer(text)
    }


def _literal_references(text: str) -> set[str]:
    references = set()
    for match in REFERENCES.finditer(text):
        reference = match.group(1) if match.group(1) else match.group(2)
        if "url(" not in reference:
            references.add(reference)
    return references


def local_references(entry_point: Path, jinja_static: bool) -> set[str]:
    """Local asset paths an entry point pulls in, relative to its static root.

    Protocol-relative and absolute URLs are ignored: they are fetched from
    another host, so they are not bundled assets of this checkout. Where an
    entry point loads a library from a CDN with a local fallback, the fallback
    is the bundled asset and is what must be credited.

    The text is percent-decoded first because a fallback script tag written
    through document.write() is stored in escaped form in the source.
    """
    text = unquote(entry_point.read_text(encoding="utf-8"))
    references = _literal_references(text)
    if jinja_static:
        references |= _jinja_static_references(text)
    return {ref for ref in references if not _is_absolute(ref)}


def resolve_reference(surface: dict, reference: str) -> Path | None:
    """The file a surface's server would serve for one entry-point reference."""
    for root in surface["static_roots"]:
        candidate = root / reference
        if candidate.is_file():
            return candidate
    return None


def load_json(path: Path, purpose: str) -> dict:
    """Read a JSON file, failing loudly on a missing or malformed file."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise AssertionError(
            f"Cannot read {purpose} {path.name}: {error}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise AssertionError(f"{path.name} is not valid JSON: {error}")


def _literal_prefix(pattern: str) -> str:
    """The part of a glob that precedes its first wildcard character."""
    for index, character in enumerate(pattern):
        if character in "*?[":
            return pattern[:index]
    return pattern


def _is_under(pattern: str, roots: tuple[str, ...]) -> bool:
    prefix = _literal_prefix(pattern)
    return any(prefix.startswith(root) for root in roots)


def misfiled_paths(credits: dict) -> list[tuple[str, str, str]]:
    """Every (surface, asset, path) credited outside that surface's own tree."""
    found = []
    for surface_name in SURFACE_NAMES:
        surface = credits.get("surfaces", {}).get(surface_name, {})
        for asset in surface.get("assets", []):
            for pattern in asset.get("paths", []):
                roots = SURFACE_ROOTS[surface_name]
                if _is_under(pattern, roots):
                    continue
                found.append((surface_name, asset.get("name", "?"), pattern))
    return found


def existing_path(pattern: str) -> bool:
    """Whether a credited path glob matches anything under a known base."""
    return any(
        glob.glob(f"{base}/{pattern}")
        for base in PATH_BASES
    )


def panel_direct_dependencies(manifest: dict) -> set[str]:
    """Package names the panel asks for at runtime.

    devDependencies are excluded: they are build-time only and never ship in
    the served panel.
    """
    return set(manifest.get("dependencies", {}))


def _panel_asset_names(credits: dict) -> set[str]:
    panel = credits.get("surfaces", {}).get("panel", {})
    return {asset.get("name") for asset in panel.get("assets", [])}


def uncredited_panel_dependencies(
        credits: dict, manifest: dict) -> set[str]:
    """Direct runtime dependencies the panel credits under no asset name."""
    return panel_direct_dependencies(manifest) - _panel_asset_names(credits)


def unknown_panel_assets(credits: dict, manifest: dict) -> set[str]:
    """Credited panel assets that name no real runtime dependency."""
    return _panel_asset_names(credits) - panel_direct_dependencies(manifest)