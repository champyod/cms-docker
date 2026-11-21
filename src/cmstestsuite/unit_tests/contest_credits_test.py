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

"""Where the contest web places the licence notice.

The notice used to trail the body block of base.html, which made it a sibling of
"#main". Contest pages push "#main" down with a relative offset, and a relative
offset moves only the painted box, so the notice landed back under the table it
follows. It now belongs inside the page content, so every layout that shows it
has to include the fragment in its own flow.
"""

import unittest
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parents[2] \
    / "cms" / "server" / "contest" / "templates"

INCLUDE = '{% include "license_notice.html" %}'

# Every template that supplies base.html's body block, i.e. every page the notice
# has to appear on: contest.html also covers the login form and the logged-in
# pages, the other four are reached directly through base.html.
LAYOUTS = (
    "contest.html",
    "credits.html",
    "contest_list.html",
    "error.html",
    "register.html",
)


class ContestNoticePlacementTest(unittest.TestCase):

    def _template(self, name: str) -> str:
        return (TEMPLATES / name).read_text(encoding="utf-8")

    def test_the_shared_body_no_longer_carries_the_notice(self):
        # Guards the move itself: the overlap came from base.html emitting the
        # notice after the body block, as a sibling of a relatively-shifted
        # "#main", so its return there would bring the defect back.
        text = self._template("base.html")
        self.assertNotIn("license_notice", text)

    def test_the_notice_markup_lives_in_one_fragment(self):
        # A second copy would drift from the credits data the notice reads.
        writers = sorted(path.name
                         for path in TEMPLATES.glob("*.html")
                         if 'class="license_notice"' in self._template(path.name))
        self.assertEqual(writers, ["license_notice.html"])

    def test_every_layout_includes_the_notice(self):
        for name in LAYOUTS:
            with self.subTest(template=name):
                self.assertIn(INCLUDE, self._template(name))

    def test_contest_puts_the_notice_inside_main(self):
        # The logged-in include has to sit inside "#main" (after the core block
        # it follows), not after the container, or the offset covers it again.
        text = self._template("contest.html")
        main = text.index('id="main"')
        include = text.index(INCLUDE, text.index("{% block core %}"))
        self.assertTrue(main < include < text.index("{% endblock body %}"))


if __name__ == "__main__":
    unittest.main()
