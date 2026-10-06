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

"""Render helpers shared by the admin web credits tests.

Kept apart from the test cases so the rendering setup reads once and the
test module stays within the project's file size limit.
"""

from pathlib import Path

from bs4 import BeautifulSoup

from cms import config
from cms.server.admin.jinja2_toolbox import AWS_ENVIRONMENT
from cms.server.credits import load_credits
from cmscommon.datetime import make_datetime

SURFACE = "admin"

# The third-party entries the contest web credits and the admin web must not
# show, since it loads none of them: a table carrying any of these belongs to
# the wrong surface. jQuery is absent from this list on purpose, the admin web
# loads it too.
CONTEST_ONLY = ["Bootstrap 2.0.4", "jQuery Migrate 3.3.2", "Tango icon theme"]


def template_path(name: str) -> Path:
    """The absolute path of one admin template."""
    return Path(__file__).resolve().parents[2] / "cms" / "server" / "admin" \
        / "templates" / name


def render(name: str, **params: object) -> str:
    """Render one admin template the way an admin handler renders it.

    params override the default render params, which is how a fork pointing the
    offer at its own repository is exercised without a running server.

    """
    defaults = {
        "config": config,
        "contest": None,
        "credits": load_credits(),
        "timestamp": make_datetime(),
        "url": lambda *args, **kwargs: "/" + "/".join(str(a) for a in args),
    }
    defaults.update(params)
    return AWS_ENVIRONMENT.get_template(name).render(**defaults)


def table_asset_names(html: str) -> list[str]:
    """The software names of the third-party table of a rendered page."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find(id="details").find("table")
    return [row.find_all("td")[0].get_text().strip()
            for row in table.find("tbody").find_all("tr", recursive=False)]