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
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Adaptive login CAPTCHA for the AWS and CWS login forms.

This is the Python/Tornado counterpart of the Next.js admin panel's
`admin-panel/src/lib/captcha.ts`, `auth-captcha-helpers.ts` and
`auth-rate-limit.ts`. The panel verifies tokens in a server action; the web
servers here have no such action, so each of them verifies the token itself
against the provider's own siteverify endpoint. No HTTP call is made to the
admin panel, and no new configuration keys were introduced: the six existing
`CAPTCHA_*` keys reach this module through the `captcha` table of
`[admin_web_server]` / `[contest_web_server]` in `config/cms.toml`.

Two properties are deliberately identical to the panel:

* it is *adaptive*, not always-on: the captcha is only demanded once an
  account or address has accumulated `threshold` failures, and
* it is *fail-open when unconfigured*: with the feature off, or with either
  key empty, no token is ever required. That is what keeps a deployment that
  sets nothing working exactly as before.

One property is deliberately the opposite of the panel: a provider error
rejects the login (fail-closed), as `verifyCaptcha` does in the panel too.

"""

import logging
import typing

from cms.conf import CaptchaConfig
from cms.server.captcha_provider import (PROVIDER_SCRIPT, TOKEN_FIELDS,
                                         extract_token, verify_token)
from cms.server.login_counters import LoginFailureCounters, is_loopback


logger = logging.getLogger(__name__)


class Captcha:
    """The adaptive captcha for one web server.

    Each server passes the `captcha` table of its own config section, so the
    two servers are configured independently even though they share a
    provider and a set of keys.

    """

    def __init__(self, config: CaptchaConfig,
                 counters: LoginFailureCounters | None = None,
                 verify: typing.Callable[[str, str, CaptchaConfig], bool]
                 | None = None) -> None:
        self.config = config
        self._counters = counters if counters is not None \
            else LoginFailureCounters()
        # WHY injectable: the verification call reaches the network, and the
        # test suite has to drive the decision logic without one.
        self._verify = verify if verify is not None else verify_token
        self._counters.set_ban_threshold(config.ban_threshold)

    @property
    def counters(self) -> LoginFailureCounters:
        return self._counters

    def is_enabled(self) -> bool:
        """Return whether the captcha can be enforced at all.

        Mirrors the panel's `isCaptchaConfigured`: enabled, plus a site key
        and a secret to actually verify with. With any of the three missing
        the captcha is not demanded, so an unconfigured deployment is never
        locked out of its own login page.

        """
        return bool(self.config.enabled) \
            and len(self.config.site_key) > 0 \
            and len(self.config.secret_key) > 0

    def provider(self) -> str:
        """Return the configured provider, defaulting to turnstile."""
        provider = (self.config.provider or "").strip().lower()
        return provider if provider in PROVIDER_SCRIPT else "turnstile"

    def is_required(self, username: str, ip: str) -> bool:
        """Return whether this attempt must carry a valid captcha token.

        False whenever the captcha is not configured, and false below the
        threshold: this is the adaptivity that distinguishes the captcha from
        an always-on one.

        """
        if not self.is_enabled():
            return False
        return self._counters.count(username, ip) >= self.threshold()

    def threshold(self) -> int:
        """Return the number of failures before the captcha becomes mandatory.

        A negative or absurd threshold is clamped to a usable value: asking
        for a captcha from the very first attempt would turn the adaptive
        captcha into an always-on one and lock out every existing client.

        """
        return max(1, self.config.threshold)

    def verify(self, username: str, ip: str, token: str) -> bool:
        """Return whether this attempt may proceed.

        The three ways through are: no captcha was demanded; a valid token
        came with the attempt; or the captcha is not configured. Anything else
        is refused, including a provider that could not be reached, which is
        the fail-closed behaviour the panel has.

        """
        if not self.is_required(username, ip):
            return True
        return self._verify(token, self.config.secret_key, self.config)

    def record_failure(self, username: str, ip: str) -> None:
        """Count a failed attempt, which may make the next one need a captcha."""
        self._counters.record_failure(username, ip)

    def record_success(self, username: str, ip: str) -> None:
        """Forget the failures behind this account and address."""
        self._counters.clear_for(username, ip)

    def widget_script(self) -> str:
        """Return the provider script URL the login page must load."""
        return PROVIDER_SCRIPT[self.provider()]

    def widget_html(self) -> str:
        """Return the widget markup for the login page.

        Mirrors the panel's login page: the provider's own class on the
        container, the site key in `data-sitekey`, and a hidden input holding
        the token so the form carries it back to the server.

        """
        if not self.is_enabled():
            return ""
        return WIDGET_TEMPLATE % {
            "class": self.provider(),
            "script": self.widget_script(),
            "site_key": self.config.site_key,
        }

    def render_params(self, username: str = "", ip: str = "") -> dict:
        """Return the captcha facts a login template needs for this client.

        *username* is whatever the client has typed so far, which is empty on a
        fresh page load: the page can then only know whether the *address* is
        over the threshold, which is the same limit the admin panel applies when
        it has no username yet.

        The secret is deliberately absent: templates render the site key, which
        is public by definition, and never the secret, which is not.

        """
        enabled = self.is_enabled()
        return {
            "captcha_enabled": enabled,
            "captcha_required": self.is_required(username, ip),
            "captcha_provider": self.provider(),
            "captcha_site_key": self.config.site_key if enabled else "",
            "captcha_script_url": self.widget_script(),
            "captcha_widget": self.widget_html() if enabled else "",
        }


WIDGET_TEMPLATE = """<div class="captcha-widget">
<script src="%(script)s" async defer></script>
<div class="%(class)s" data-sitekey="%(site_key)s"></div>
<input type="hidden" name="captchaToken" value="">
</div>"""


def is_loopback_client(ip: str) -> bool:
    """Return whether *ip* is a loopback address, as a string.

    Exposed for callers that want the panel's loopback exemption without
    reaching into the counters.

    """
    return is_loopback(ip)


__all__ = ["Captcha", "LoginFailureCounters", "is_loopback_client"]