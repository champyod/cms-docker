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

import unittest
from fnmatch import fnmatch
from pathlib import Path

from cmstestsuite.unit_tests.credits_schema import (
    CREDITS_PATH,
    PANEL_MANIFEST,
    REPO_ROOT,
    SRC_ROOT,
    SURFACE_ENTRY_POINTS,
    SURFACE_NAMES,
    existing_path,
    load_json,
    local_references,
    misfiled_paths,
    panel_direct_dependencies,
    resolve_reference,
    unknown_panel_assets,
    uncredited_panel_dependencies,
)


def load_credits() -> dict:
    """Read credits.json, failing loudly on a missing or malformed file."""
    return load_json(CREDITS_PATH, "credits file")


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
        surface_def = SURFACE_ENTRY_POINTS[name]
        surface = self._surface(name)
        first_party = surface.get("first_party", [])
        uncredited = []
        for reference in sorted(local_references(
                surface_def["entry_point"], surface_def["jinja_static"])):
            path = resolve_reference(surface_def, reference)
            if path is None or not _credited(surface["assets"], first_party, path):
                uncredited.append(reference)
        return uncredited

    def test_local_assets_are_credited(self):
        for name in ("contest", "admin", "ranking"):
            with self.subTest(surface=name):
                uncredited = self._uncredited(name)
                self.assertEqual(
                    uncredited, [],
                    f"{SURFACE_ENTRY_POINTS[name]['entry_point'].name} loads "
                    f"assets that {CREDITS_PATH.name} does not credit for "
                    f"{name}: " + ", ".join(uncredited))

    def test_credited_paths_exist(self):
        for name in SURFACE_NAMES:
            with self.subTest(surface=name):
                missing = [pattern
                           for asset in self._surface(name)["assets"]
                           for pattern in asset.get("paths", [])
                           if not existing_path(pattern)]
                self.assertEqual(
                    missing, [],
                    f"{CREDITS_PATH.name} credits a path that is not in the "
                    f"tree: " + ", ".join(missing))

    def test_each_surface_credits_only_its_own_tree(self):
        # WHY: a per-surface list that points into another surface's tree
        # duplicates credits and hides which surface actually ships a file.
        offenders = misfiled_paths(self.credits)
        self.assertEqual(
            offenders, [],
            f"{CREDITS_PATH.name} files an asset under a surface that does "
            f"not ship it: "
            + ", ".join(f"{s}/{a} -> {p}" for s, a, p in offenders))

    def test_panel_credits_match_its_runtime_dependencies(self):
        # WHY the panel needs this of its own: it has no HTML entry point to
        # scan, so nothing else would notice a stale or invented dependency.
        manifest = load_json(PANEL_MANIFEST, "panel manifest")
        uncredited = uncredited_panel_dependencies(self.credits, manifest)
        self.assertEqual(
            uncredited, set(),
            f"{CREDITS_PATH.name} credits no panel asset for these runtime "
            f"dependencies: " + ", ".join(sorted(uncredited)))
        unknown = unknown_panel_assets(self.credits, manifest)
        self.assertEqual(
            unknown, set(),
            f"{CREDITS_PATH.name} credits panel assets that are not runtime "
            f"dependencies of {PANEL_MANIFEST.name}: "
            + ", ".join(sorted(unknown)))

    def test_panel_credits_cover_every_runtime_dependency(self):
        # Guards the manifest read itself: an empty dependency set would make
        # the cross-check above pass while crediting nothing.
        manifest = load_json(PANEL_MANIFEST, "panel manifest")
        self.assertTrue(
            panel_direct_dependencies(manifest),
            f"{PANEL_MANIFEST.name} declares no runtime dependencies, so the "
            f"panel credit cross-check would be vacuous")


if __name__ == "__main__":
    unittest.main()