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
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Tests for the licence notice and credits the scoreboard serves.

The scoreboard is public and unauthenticated, so its notice, its credits
endpoint and the assets it loads are checked here rather than left to review.
Every case is deterministic: the handlers are driven through a hand-built WSGI
environ and no socket is opened.
"""

import io
import json
import unittest
from fnmatch import fnmatch
from pathlib import Path

from bs4 import BeautifulSoup

from cms.server.credits import get_surface
from cmsranking.Config import PublicConfig
from cmsranking.RankingWebServer import (CreditsHandler, PublicConfigHandler,
                                         RoutingHandler)
from cmstestsuite.unit_tests.credits_schema import (
    REPO_ROOT, SRC_ROOT, SURFACE_ENTRY_POINTS, load_json, local_references,
    resolve_reference)

SURFACE = "ranking"
CREDITS_PATH = REPO_ROOT / "credits.json"
ENTRY_POINT = SURFACE_ENTRY_POINTS[SURFACE]["entry_point"]
STATIC_ROOT = SURFACE_ENTRY_POINTS[SURFACE]["static_roots"][0]

# The bundled third-party code the scoreboard entry point pulls in, each with
# the asset name credits.json is expected to file it under.
BUNDLED_LIBRARIES = {
    "lib/jquery.js": "jQuery 3.6.0",
    "lib/eventsource.js": "EventSource",
    "lib/raphael.js": "Raphael",
    "lib/explorercanvas.js": "explorerCanvas",
}

# Tags that force a line break or start a block, so none may appear inside a
# notice that has to stay on one line.
BREAKING = ["br", "div", "p", "table", "ul", "ol", "li", "h1", "h2", "pre"]


def environ_for(path: str) -> dict:
    """A minimal GET environ, enough for the handlers under test."""
    return {
        "REQUEST_METHOD": "GET", "SCRIPT_NAME": "", "PATH_INFO": path,
        "QUERY_STRING": "", "SERVER_NAME": "ranking.test", "SERVER_PORT": "80",
        "SERVER_PROTOCOL": "HTTP/1.1", "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(b""), "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False, "wsgi.multiprocess": False,
        "wsgi.run_once": False,
    }


def call(handler, path: str) -> tuple[str, dict, bytes]:
    """Run one handler and return its status, headers and raw body."""
    captured: dict = {}

    def start_response(status, headers, exc_info=None):
        captured["status"] = status
        captured["headers"] = dict(headers)

    body = b"".join(handler(environ_for(path), start_response))
    return captured["status"], captured["headers"], body


def call_json(handler, path: str) -> dict:
    """Run one handler and decode its JSON body, failing loudly otherwise."""
    status, headers, body = call(handler, path)
    if not status.startswith("200"):
        raise AssertionError(
            f"{type(handler).__name__} answered {status} for {path}: "
            f"{body.decode('utf-8', 'replace')}")
    content_type = headers.get("Content-Type", "")
    if "application/json" not in content_type:
        raise AssertionError(
            f"{type(handler).__name__} answered {content_type!r} for {path}, "
            f"which is not the JSON the page fetches")
    return json.loads(body)


def glob_matches(patterns: list[str], path: Path) -> bool:
    """Whether a credited glob covers a resolved file."""
    return any(fnmatch(str(path), f"{base}/{pattern}")
               for pattern in patterns for base in (REPO_ROOT, SRC_ROOT))


def credited_asset_names(assets: list[dict], path: Path) -> list[str]:
    """The names under which credits.json files a resolved file."""
    return [asset["name"] for asset in assets
            if glob_matches(asset.get("paths", []), path)]


class EndpointTest(unittest.TestCase):

    def setUp(self):
        self.credits_file = load_json(CREDITS_PATH, "credits file")
        self.served = call_json(CreditsHandler(), "/credits")

    def test_it_serves_the_ranking_surface(self):
        self.assertEqual(self.served["surface"], get_surface(SURFACE))

    def test_the_asset_set_matches_the_credits_file(self):
        names = [asset["name"] for asset in self.served["surface"]["assets"]]
        expected = [asset["name"] for asset
                    in self.credits_file["surfaces"][SURFACE]["assets"]]
        self.assertEqual(names, expected)
        self.assertTrue(names, "the scoreboard credits no third-party asset")

    def test_it_carries_the_project_and_its_licence(self):
        self.assertEqual(self.served["project"], self.credits_file["project"])
        self.assertEqual(self.served["license"], self.credits_file["license"])
        self.assertEqual(self.served["license"]["spdx_id"], "AGPL-3.0")
        # WHY only these three keys: the scoreboard is unauthenticated, so it
        # must not carry the asset lists of components nobody reaches here.
        self.assertEqual(sorted(self.served), ["license", "project", "surface"])

    def test_the_default_source_url_names_the_fork_repository(self):
        self.assertEqual(PublicConfig().source_url,
                         self.credits_file["project"]["url"])

    def test_a_fork_can_point_the_offer_at_its_own_repository(self):
        own = "https://git.example.invalid/own/cms"
        served = call_json(PublicConfigHandler(PublicConfig(source_url=own)),
                           "/config")
        self.assertEqual(served["source_url"], own)

    def test_the_served_config_offers_a_source_url(self):
        served = call_json(PublicConfigHandler(PublicConfig()), "/config")
        self.assertEqual(sorted(served), ["show_id_column", "source_url"])
        self.assertTrue(served["source_url"],
                        "the scoreboard would offer no source to a visitor")


class RoutingTest(unittest.TestCase):

    def setUp(self):
        self.served: list[str] = []
        self.handler = RoutingHandler(*(self.recorder(name) for name in (
            "root", "events", "logo", "scores", "history", "config",
            "credits")))

    def recorder(self, name: str):
        """A stand-in handler that only notes that it was reached."""
        def handle(environ, start_response):
            self.served.append(name)
            start_response("200 OK", [("Content-Type", "text/plain")])
            return [b""]
        return handle

    def resolve(self, path: str):
        return self.handler.router.bind_to_environ(environ_for(path)).match()

    def test_credits_route_resolves_and_is_dispatched(self):
        self.assertEqual(self.resolve("/credits"), ("credits", {}))
        call(self.handler, "/credits")
        self.assertEqual(self.served, ["credits"])

    def test_config_route_still_resolves_and_is_dispatched(self):
        self.assertEqual(self.resolve("/config"), ("public_config", {}))
        call(self.handler, "/config")
        self.assertEqual(self.served, ["config"])


class NoticeTest(unittest.TestCase):

    def setUp(self):
        self.page = ENTRY_POINT.read_text(encoding="utf-8")
        self.soup = BeautifulSoup(self.page, "html.parser")
        self.notice = self.soup.find(id="LicenseNotice")

    def test_the_notice_is_a_single_element_holding_one_line(self):
        self.assertIsNotNone(self.notice)
        self.assertEqual(self.notice.name, "div")
        self.assertIsNone(self.notice.find_parent(id="LicenseNotice"))
        self.assertEqual(self.notice.find("table"), None)
        # A source newline is collapsed by the renderer, so what decides
        # whether the notice wraps is its content, not the file's layout.
        self.assertEqual(self.notice.find(BREAKING), None)
        self.assertNotEqual(" ".join(self.notice.get_text().split()), "")

    def test_the_notice_carries_the_licence_the_offer_and_the_credits(self):
        self.assertIn("AGPL-3.0", self.notice.get_text())
        self.assertIsNotNone(self.notice.find(id="LicenseNotice_source"))
        self.assertEqual(self.notice.find(id="LicenseNotice_credits")["href"],
                         "credits.html")
        self.assertTrue((STATIC_ROOT / "credits.html").is_file())

    def test_the_offer_follows_the_runtime_config(self):
        # WHY: the offer has to name the running deployment's own repository,
        # so none may be written into the page for a fork to inherit.
        self.assertNotIn("https://github.com/", self.page)
        self.assertNotIn("source_url", self.notice.get_text())
        self.assertIn('PublicConfig["source_url"]', self.page)


class RenderedAssetsAreCreditedTest(unittest.TestCase):

    def setUp(self):
        surface = load_json(CREDITS_PATH, "credits file")["surfaces"][SURFACE]
        self.assets = surface["assets"]
        self.first_party = surface.get("first_party", [])
        self.surface = SURFACE_ENTRY_POINTS[SURFACE]
        self.references = local_references(self.surface["entry_point"],
                                           self.surface["jinja_static"])

    def test_every_bundled_library_is_credited_by_name(self):
        for reference, name in BUNDLED_LIBRARIES.items():
            with self.subTest(reference=reference):
                self.assertIn(reference, self.references)
                path = resolve_reference(self.surface, reference)
                self.assertIsNotNone(path,
                                     f"{reference} is served by no static root")
                self.assertIn(name, credited_asset_names(self.assets, path))

    def test_every_local_reference_is_credited(self):
        uncredited = []
        for reference in sorted(self.references):
            path = resolve_reference(self.surface, reference)
            if path is None or not (
                    glob_matches(self.first_party, path)
                    or credited_asset_names(self.assets, path)):
                uncredited.append(reference)
        self.assertEqual(
            uncredited, [],
            f"{ENTRY_POINT.name} loads assets {CREDITS_PATH.name} does not "
            f"credit for {SURFACE}: " + ", ".join(uncredited))


if __name__ == "__main__":
    unittest.main()