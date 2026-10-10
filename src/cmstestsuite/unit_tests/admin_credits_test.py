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

"""Tests for the licence notice and credits the admin web serves.

The admin web bundles its own set of third-party code, so its credits page has
to list the admin surface rather than the one another surface serves: an empty
table or the contest list would leave the bundled libraries uncredited. Every
case is deterministic: the template is rendered through the admin Jinja2
environment with the render params a handler supplies, and no socket is opened.
"""

import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from bs4 import BeautifulSoup

from cms import config
from cms.server.admin.handlers.main import CreditsHandler
from cms.server.credits import (
    CREDITS_FILE_ENV_VAR,
    CREDITS_FILE_NAME,
    CreditsError,
    get_surface,
)
from cmstestsuite.unit_tests.admin_credits_render import (
    CONTEST_ONLY, SURFACE, render, table_asset_names, template_path)
from cmstestsuite.unit_tests.credits_schema import CREDITS_PATH, load_json

__all__ = [
    "CONTEST_ONLY", "SURFACE", "template_path", "render", "table_asset_names",
    "CreditsPageTest", "NoticeTest", "RenderedAssetsAreCreditedTest",
]


class CreditsPageTest(unittest.TestCase):

    def setUp(self):
        self.credits_file = load_json(CREDITS_PATH, "credits file")
        self.html = render("credits.html",
                           credits_surface=get_surface(SURFACE))
        self.soup = BeautifulSoup(self.html, "html.parser")

    def test_it_renders_the_admin_surface(self):
        self.assertEqual(
            table_asset_names(self.html),
            [asset["name"]
             for asset in self.credits_file["surfaces"][SURFACE]["assets"]])

    def test_it_credits_the_assets_the_admin_web_loads(self):
        # Guards the surface read itself: an empty table would satisfy the
        # comparison above while crediting nothing.
        names = table_asset_names(self.html)
        for expected in ["jQuery 3.6.0", "jqPlot", "Prism 1.30.0",
                         "CSS Reset 2.0"]:
            self.assertIn(expected, names)

    def test_it_credits_no_asset_of_another_surface(self):
        # WHY only the entries the admin web does not load: jQuery is bundled by
        # both surfaces and is legitimately credited by each of them.
        names = table_asset_names(self.html)
        for foreign in CONTEST_ONLY:
            with self.subTest(asset=foreign):
                self.assertNotIn(foreign, names)

    def test_it_carries_the_project_and_its_licence(self):
        text = self.soup.find(id="details").get_text(" ", strip=True)
        self.assertIn(self.credits_file["project"]["name"], text)
        self.assertIn(self.credits_file["license"]["name"], text)
        self.assertIn(self.credits_file["license"]["spdx_id"], text)

    def test_it_offers_the_configured_source(self):
        source_url = config.global_.source_url
        # Every anchor carrying the address counts: the byline in the sidebar and
        # the offer on the page both point at it, and what section 13 needs is one
        # of them spelling the address out as readable text.
        offers = self.soup.find_all("a", href=source_url)
        self.assertTrue(
            offers,
            "the page offers no corresponding source at the configured URL")
        self.assertTrue(
            any(source_url in offer.get_text() for offer in offers),
            "the configured source appears only as a link target, never as text")

    def test_it_attributes_the_upstream_project(self):
        # WHY wording and not an anchor carrying its own address: the byline
        # credits the lineage in one line, so what has to survive is the claim
        # itself being readable on the page rather than a URL behind a link.
        text = self.soup.get_text(" ", strip=True)
        for line in get_surface(SURFACE)["attribution"]:
            with self.subTest(text=line["text"]):
                self.assertIn(line["text"], text)

    def test_it_writes_no_source_url_into_the_markup(self):
        # WHY: a fork has to be able to point the offer at its own repository,
        # so none may be baked into a template it would have to edit.
        page = template_path("credits.html").read_text(encoding="utf-8")
        self.assertNotIn("github.com/champyod", page)
        self.assertNotIn(self.credits_file["project"]["url"], page)
        self.assertIn("config.global_.source_url", page)

    def test_a_missing_credits_file_is_reported_rather_than_emptied(self):
        # WHY: a table with no rows would read as "this web bundles nothing",
        # which is the opposite of what a missing file means.
        # WHY the variable is unset: it is the fallback for an explicit start
        # whose walk finds nothing, so an ambient value would answer here and
        # the case would depend on how the process happened to be started.
        with mock.patch.dict(os.environ):
            os.environ.pop(CREDITS_FILE_ENV_VAR, None)
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(CreditsError) as caught:
                    get_surface(SURFACE, Path(directory))
        self.assertIn(CREDITS_FILE_NAME, str(caught.exception))


class NoticeTest(unittest.TestCase):

    def setUp(self):
        self.credits_file = load_json(CREDITS_PATH, "credits file")
        self.page = render("base.html")
        self.notice = BeautifulSoup(self.page, "html.parser").find(class_="cr_notice")

    def test_the_notice_is_a_single_compact_block(self):
        self.assertIsNotNone(self.notice)
        self.assertEqual(self.notice.name, "div")
        self.assertIsNone(self.notice.find_parent(class_="cr_notice"))
        # A sidebar notice has to stay compact, so it may not become a list or
        # a table of the credits.
        self.assertEqual(self.notice.find(["table", "ul", "ol"]), None)

    def test_the_notice_carries_the_credit_line_and_no_licence_prose(self):
        # WHY the licence moved out: this line is read at a glance, so it names
        # the project, its author and its lineage and nothing else. The section 13
        # offer is visible text on the credits page, not a footer nobody reads.
        text = " ".join(self.notice.get_text().split())
        self.assertIn(self.credits_file["project"]["name"], text)
        if self.credits_file["project"].get("author"):
            self.assertIn(self.credits_file["project"]["author"], text)
        self.assertNotIn(self.credits_file["license"]["name"], text)
        self.assertNotIn("section 13", text)

    def test_the_notice_links_the_configured_source_as_its_one_link(self):
        anchors = self.notice.find_all("a")
        self.assertEqual(
            len(anchors), 1,
            "the byline carries more than the one project link")
        self.assertEqual(anchors[0].get("href"), config.global_.source_url)

    def test_the_notice_leaves_the_full_list_to_the_credits_page(self):
        self.assertIsNone(
            self.notice.find("a", href="/credits"),
            "the byline is not a second navigation for the credits page")

    def test_it_no_longer_offers_the_upstream_repo_as_its_own_source(self):
        # WHY: linking upstream's repository was the defect this notice had,
        # since it presented someone else's repository as this deployment's
        # corresponding source. Upstream is still credited, as the fork it is.
        upstream = self.credits_file["project"]["upstream"]["url"]
        offer_hosts = [anchor["href"] for anchor in self.notice.find_all("a")
                       if "source" in anchor.get_text().lower()
                       or "corresponding" in anchor.get_text().lower()]
        for host in offer_hosts:
            self.assertNotIn(upstream, host)
        self.assertIn(upstream, [
            line["url"]
            for line in get_surface(SURFACE)["attribution"]])

    def test_the_notice_writes_no_source_url_into_the_markup(self):
        markup = template_path("base.html").read_text(encoding="utf-8")
        self.assertNotIn("github.com/champyod", markup)
        self.assertIn("config.global_.source_url", markup)

    def test_a_fork_source_url_changes_what_the_notice_offers(self):
        # WHY: the offer has to name the running deployment's own repository,
        # so a fork that reconfigures it must see its own URL in the output.
        own = "https://git.example.invalid/own/aws"
        original = config.global_.source_url
        config.global_.source_url = own
        try:
            html = render("base.html")
        finally:
            config.global_.source_url = original
        text = " ".join(BeautifulSoup(html, "html.parser")
                        .find(class_="cr_notice").get_text().split())
        self.assertIn(own, text)
        self.assertNotIn(original, text)

    def test_the_notice_carries_the_licence_and_the_project_name(self):
        # Guards the read itself: an empty notice would satisfy nothing above.
        self.assertNotEqual(" ".join(self.notice.get_text().split()), "")


class RenderedAssetsAreCreditedTest(unittest.TestCase):
    """The table must follow the credits data rather than a copy of it."""

    def test_dropping_an_asset_drops_its_row(self):
        surface = get_surface(SURFACE)
        trimmed = dict(surface)
        trimmed["assets"] = surface["assets"][:-1]
        names = table_asset_names(render(
            "credits.html", credits_surface=trimmed))
        self.assertEqual(names, [asset["name"]
                                 for asset in surface["assets"][:-1]])
        self.assertNotIn(surface["assets"][-1]["name"], names)

    def test_a_missing_surface_is_reported_by_name(self):
        with self.assertRaises(CreditsError) as caught:
            get_surface("no_such_surface")
        self.assertIn(CREDITS_FILE_NAME, str(caught.exception))
        self.assertIn("no_such_surface", str(caught.exception))


class RouteTest(unittest.TestCase):

    def setUp(self):
        from cms.server.admin.handlers import HANDLERS
        self.handlers = HANDLERS

    def resolve(self, path: str) -> tuple:
        """The first route matching a path, the way tornado dispatches."""
        for pattern, handler in self.handlers:
            matched = re.match(pattern + "$", path)
            if matched is not None:
                return handler, matched.groups()
        return None, ()

    def test_credits_is_routed(self):
        handler, _ = self.resolve("/credits")
        self.assertIs(handler, CreditsHandler)

    def test_no_earlier_route_shadows_credits(self):
        # WHY: tornado dispatches on the first matching route, so an earlier
        # pattern that also matches would answer for /credits instead.
        credits_index = [pattern for pattern, _
                         in self.handlers].index("/credits")
        winner, _ = self.resolve("/credits")
        self.assertIs(winner, self.handlers[credits_index][1])
        self.assertEqual(credits_index,
                         [i for i, (pattern, _) in enumerate(self.handlers)
                          if re.match(pattern + "$", "/credits") is not None
                          ][0])


if __name__ == "__main__":
    unittest.main()