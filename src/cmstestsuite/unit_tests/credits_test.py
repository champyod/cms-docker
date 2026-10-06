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

"""Keep credits.json in step with the assets each surface actually loads.

A bundled third-party library that ships uncredited is a licence-compliance
failure, so every local script/style reference of a surface's entry point has
to be covered by a first-party glob or by a credited asset.
"""

import glob
import json
import re
import unittest
from fnmatch import fnmatch
from pathlib import Path
from urllib.parse import unquote

# WHY resolved from __file__: the checkout may be tested from any working
# directory, and a CWD-relative lookup would silently miss the file.
REPO_ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = REPO_ROOT / "src"
CREDITS_PATH = REPO_ROOT / "credits.json"

# Each surface's entry point, together with the static roots its web server
# mounts. The first root that contains the reference wins, mirroring the
# server's own static_files order.
SURFACES = {
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

SURFACE_NAMES = ["contest", "admin", "ranking", "panel"]

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


def load_credits() -> dict:
    """Read credits.json, failing loudly on a missing or malformed file."""
    try:
        raw = CREDITS_PATH.read_text(encoding="utf-8")
    except OSError as error:
        raise AssertionError(f"Cannot read credits file {CREDITS_PATH}: {error}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise AssertionError(f"{CREDITS_PATH.name} is not valid JSON: {error}")


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


def _resolve(surface: dict, reference: str) -> Path | None:
    for root in surface["static_roots"]:
        candidate = root / reference
        if candidate.is_file():
            return candidate
    return None


def _matches(patterns: list[str], path: Path) -> bool:
    for pattern in patterns:
        if fnmatch(str(path), f"{REPO_ROOT}/{pattern}") or \
                fnmatch(str(path), f"{SRC_ROOT}/{pattern}"):
            return True
    return False


def _credited(assets: list[dict], first_party: list[str], path: Path) -> bool:
    if _matches(first_party, path):
        return True
    for asset in assets:
        if _matches(asset.get("paths", []), path):
            return True
    return False


class TestCredits(unittest.TestCase):

    def setUp(self):
        self.credits = load_credits()

    def _surface(self, name: str) -> dict:
        try:
            return self.credits["surfaces"][name]
        except KeyError:
            raise AssertionError(
                f"{CREDITS_PATH.name} has no '{name}' surface")

    def test_credits_file_is_valid_json(self):
        self.assertIsInstance(self.credits, dict)

    def test_every_surface_has_a_license_and_attribution(self):
        self.assertEqual(self.credits["license"]["spdx_id"], "AGPL-3.0")
        for name in SURFACE_NAMES:
            with self.subTest(surface=name):
                surface = self._surface(name)
                self.assertTrue(surface["assets"],
                                f"{name} credits no third-party asset")
                self.assertTrue(surface["attribution"],
                                f"{name} credits no attribution line")

    def test_upstream_surfaces_claim_no_ownership(self):
        # WHY: those three surfaces are upstream code that this fork has not
        # fully rebuilt, so naming a person as their author would be false.
        for name in ("contest", "admin", "ranking"):
            with self.subTest(surface=name):
                lines = self._surface(name)["attribution"]
                self.assertTrue(
                    any("fork of CMS (cms-dev)" in line["text"] for line in lines)
                )
                for line in lines:
                    self.assertNotIn("CCYod", line["text"])

    def test_panel_credits_its_author(self):
        lines = self._surface("panel")["attribution"]
        self.assertTrue(any("CCYod" in line["text"] for line in lines))
        self.assertTrue(any(line["url"] == "https://github.com/champyod"
                            for line in lines))

    def _uncredited(self, name: str) -> list[str]:
        surface_def = SURFACES[name]
        surface = self._surface(name)
        first_party = surface.get("first_party", [])
        uncredited = []
        for reference in sorted(local_references(
                surface_def["entry_point"], surface_def["jinja_static"])):
            path = _resolve(surface_def, reference)
            if path is None or not _credited(surface["assets"], first_party, path):
                uncredited.append(reference)
        return uncredited

    def test_local_assets_are_credited(self):
        for name in ("contest", "admin", "ranking"):
            with self.subTest(surface=name):
                uncredited = self._uncredited(name)
                self.assertEqual(
                    uncredited, [],
                    f"{SURFACES[name]['entry_point'].name} loads assets that "
                    f"{CREDITS_PATH.name} does not credit for {name}: "
                    + ", ".join(uncredited))

    def test_credited_paths_exist(self):
        for name in SURFACE_NAMES:
            with self.subTest(surface=name):
                missing = [pattern
                           for asset in self._surface(name)["assets"]
                           for pattern in asset.get("paths", [])
                           if not glob.glob(str(SRC_ROOT / pattern))]
                self.assertEqual(
                    missing, [],
                    f"{CREDITS_PATH.name} credits a path that is not in the "
                    f"tree: " + ", ".join(missing))


if __name__ == "__main__":
    unittest.main()