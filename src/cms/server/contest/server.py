#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2010-2014 Giovanni Mascellani <mascellani@poisson.phc.unipi.it>
# Copyright © 2010-2015 Stefano Maggiolo <s.maggiolo@gmail.com>
# Copyright © 2010-2012 Matteo Boscariol <boscarim@hotmail.com>
# Copyright © 2012-2015 Luca Wehrstedt <luca.wehrstedt@gmail.com>
# Copyright © 2013 Bernard Blackham <bernard@largestprime.net>
# Copyright © 2014 Artem Iglikov <artem.iglikov@gmail.com>
# Copyright © 2014 Fabian Gundlach <320pointsguy@gmail.com>
# Copyright © 2015-2016 William Di Luigi <williamdiluigi@gmail.com>
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

"""ContestWebServer serves the webpage that contestants are using to:

- view information about the contest (times, ...);
- view tasks;
- view documentation (STL, ...);
- submit questions;
- view announcements and answer to questions;
- submit solutions;
- view the state and maybe the score of their submissions;
- release submissions to see their full score;
- query the test interface.

"""

from datetime import datetime
import logging
import os

from werkzeug.middleware.shared_data import SharedDataMiddleware

from cms import ConfigError, ServiceCoord, config
from cms.db import NO_OVERRIDE, NoOverride, contest_binding
from cms.io import WebService
from cms.locale import get_translations
from cms.server.contest.jinja2_toolbox import CWS_ENVIRONMENT
from cmscommon.binary import hex_to_bin
from .handlers import HANDLERS
from .handlers.base import ContestListHandler
from .handlers.main import MainHandler


logger = logging.getLogger(__name__)


SECONDS_IN_A_YEAR = 365 * 24 * 60 * 60


class ContestWebServer(WebService):
    """Service that runs the web server serving the contestants.

    """
    def __init__(self, shard: int, contest_id: "int | None | NoOverride" = NO_OVERRIDE):
        parameters = {
            "static_files": [("cms.server", "static"),
                             ("cms.server.contest", "static")],
            "cookie_secret": hex_to_bin(config.web_server.secret_key),
            "debug": config.web_server.tornado_debug,
            "is_proxy_used": None,
            "num_proxies_used": config.contest_web_server.num_proxies_used,
            "xsrf_cookies": True,
        }

        # WHY the row's own port wins: the generated compose publishes one port per registry
        # row, and the shared listen_port is a single shard-indexed list, so it cannot
        # describe a second contest server.
        override_port = os.environ.get("SERVICE_HTTP_PORT")
        try:
            listen_address = config.contest_web_server.listen_address[shard]
            listen_port = int(override_port) if override_port else config.contest_web_server.listen_port[shard]
        except IndexError:
            raise ConfigError("Wrong shard number for %s, or missing "
                              "address/port configuration. Please check "
                              "listen_address and listen_port "
                              "in cms.toml." % __name__)

        self._contest_override = contest_id
        # WHY the shape is settled here and the contest is not: the routing table below
        # describes one URL scheme — a single contest, or all of them behind /<name>/ — and a
        # running table cannot follow a change of scheme. Which contest that scheme serves is
        # read per request (see contest_id below), so only the shape is fixed here.
        self._multi_contest_shape = contest_binding(
            self.__class__.__name__, shard, contest_id) is None

        if self._multi_contest_shape:
            HANDLERS.append((r"", MainHandler))
            handlers = [(r'/', ContestListHandler)]
            for h in HANDLERS:
                handlers.append((r'/([^/]+)' + h[0],) + h[1:])
        else:
            HANDLERS.append((r"/", MainHandler))
            handlers = HANDLERS

        super().__init__(
            listen_port,
            handlers,
            parameters,
            shard=shard,
            listen_address=listen_address)

        self.wsgi_app = SharedDataMiddleware(
            self.wsgi_app, {"/docs": config.contest_web_server.docs_path
                            or config.contest_web_server.stl_path},
            cache=True, cache_timeout=SECONDS_IN_A_YEAR,
            fallback_mimetype="application/octet-stream")

        self.jinja2_environment = CWS_ENVIRONMENT

        # This is a dictionary (indexed by username) of pending
        # notification. Things like "Yay, your submission went
        # through.", not things like "Your question has been replied",
        # that are handled by the db. Each username points to a list
        # of tuples (timestamp, subject, text, level).
        self.notifications: dict[str, list[tuple[datetime, str, str, str]]] = {}

        # Retrieve the available translations.
        self.translations = get_translations()

        self.evaluation_service = self.connect_to(
            ServiceCoord("EvaluationService", 0))
        self.scoring_service = self.connect_to(
            ServiceCoord("ScoringService", 0))

        ranking_enabled = len(config.proxy_service.rankings) > 0
        self.proxy_service = self.connect_to(
            ServiceCoord("ProxyService", 0),
            must_be_present=ranking_enabled)

    @property
    def contest_id(self) -> int | None:
        """The contest this server serves, re-read from the registry for every request.

        A different contest is picked up within the registry TTL without a restart. A change
        of shape — between one contest and all of them — is refused instead: the routing
        table built at start-up describes one URL scheme, so that change needs a recreate.
        """
        contest_id = contest_binding(self.name, self.shard, self._contest_override)
        if (contest_id is None) != self._multi_contest_shape:
            raise ConfigError(
                "the registry changed whether %s serves one contest or all of them, which "
                "changes the URL scheme a running routing table cannot follow — recreate "
                "this service ('./cms deploy contest')." % self.name)
        return contest_id

    def add_notification(
        self, username: str, timestamp: datetime, subject: str, text: str, level: str
    ):
        """Store a new notification to send to a user at the first
        opportunity (i.e., at the first request fot db notifications).

        username: the user to notify.
        timestamp: the time of the notification.
        subject: subject of the notification.
        text: body of the notification.
        level: one of NOTIFICATION_* (defined above)

        """
        if username not in self.notifications:
            self.notifications[username] = []
        self.notifications[username].append((timestamp, subject, text, level))
