#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026 Champ <noreply@example.invalid>
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
# along with this program. If not, see <http://www.gnu.org/licenses/>.

"""The credit footer renders at one size on every service.

Usage: python3 tests/test_credit_footer_size.py
"""

import os
import re
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# The one size the services' credit footers are unified on, in pixels.
UNIFIED_FONT_SIZE_PX = 16.0
# The services set html { font-size: 100% }, so their em values resolve here.
ROOT_FONT_SIZE_PX = 16.0

# label, path, kind, selector — the footers that must agree, read from source.
FOOTERS = (
    ("contest", "src/cms/server/contest/static/cws_style.css", "css", ".license_notice"),
    ("admin", "src/cms/server/admin/static/aws_style.css", "css", ".cr_notice"),
    ("ranking static", "ranking-web/static/Ranking.html", "inline", "LicenseNotice"),
    ("ranking template", "ranking-web/templates/ranking.html", "inline", "LicenseNotice"),
)


def read(path: str) -> str:
    with open(os.path.join(REPO_ROOT, path), encoding="utf-8") as source:
        return source.read()


def css_font_size(text: str, selector: str) -> str:
    block = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", text)
    if block is None:
        raise AssertionError(f"{selector} has no rule block")
    return declared_font_size(block.group(1), selector)


def inline_font_size(text: str, element_id: str) -> str:
    style = re.search(r'id="' + re.escape(element_id) + r'"[^>]*style="([^"]*)"', text)
    if style is None:
        raise AssertionError(f"#{element_id} has no style attribute")
    return declared_font_size(style.group(1), element_id)


def declared_font_size(declarations: str, context: str) -> str:
    match = re.search(r"font-size:\s*([^;]+);", declarations)
    if match is None:
        raise AssertionError(f"{context} carries no font-size")
    return match.group(1).strip()


def to_px(value: str) -> float:
    if value.endswith("px"):
        return float(value[:-2])
    if value.endswith("em"):
        return float(value[:-2]) * ROOT_FONT_SIZE_PX
    raise AssertionError(f"cannot resolve {value!r} to pixels")


def footer_font_size(path: str, kind: str, selector: str) -> float:
    text = read(path)
    value = css_font_size(text, selector) if kind == "css" else inline_font_size(text, selector)
    return to_px(value)


class CreditFooterSizeTest(unittest.TestCase):

    def test_every_service_renders_the_footer_at_one_size(self):
        for label, path, kind, selector in FOOTERS:
            with self.subTest(footer=label):
                self.assertEqual(footer_font_size(path, kind, selector),
                                 UNIFIED_FONT_SIZE_PX)


if __name__ == "__main__":
    unittest.main()
