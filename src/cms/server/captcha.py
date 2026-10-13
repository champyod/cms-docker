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
from cms.server.captcha_health import ProviderHealth, build_health
from cms.server.captcha_provider import (PROVIDER_SCRIPT, PROVIDER_WIDGET_CLASS,
                                         TOKEN_FIELDS, ProviderUnreachable,
                                         extract_token, verify_token)
from cms.server.login_counters import (LoginFailureCounters, build_counters,
                                        is_loopback)


logger = logging.getLogger(__name__)


class Captcha:
    """The adaptive captcha for one web server.

    Each server passes the `captcha` table of its own config section, so the
    two servers are configured independently even though they share a
    provider and a set of keys.

    """

    def __init__(self, config: CaptchaConfig,
                 counters: LoginFailureCounters | None = None,
                 verify: typing.Callable[[str, str, str], bool]
                 | None = None,
                 health: ProviderHealth | None = None) -> None:
        self.config = config
        # WHY built from the config when not injected: the counts are kept in a
        # shared Redis when one is configured, and that has to be decided once
        # at construction rather than per request.
        self._counters = counters if counters is not None \
            else build_counters(config)
        # WHY injectable: the verification call reaches the network, and the
        # test suite has to drive the decision logic without one.
        self._verify = verify if verify is not None else verify_token
        # WHY built once: the provider a request renders and the one it verifies
        # against must agree, and the health that decides the first has to be the
        # same store the verification failure updates.
        self._health = health if health is not None else build_health(config)
        self._counters.set_ban_threshold(config.ban_threshold)

    @property
    def counters(self) -> LoginFailureCounters:
        return self._counters

    @property
    def degraded(self) -> bool:
        """Return whether the shared counter store could not be reached.

        True means the counts are process-local because Redis was unreachable,
        so the lockout no longer spans the deployment. The caller sees it to
        make the deployment's condition visible; nothing about the login
        decision changes on its own.

        """
        return self._counters.degraded

    def is_locked(self, username: str, ip: str) -> bool:
        """Return whether this account and address are refused outright.

        Deliberately NOT gated on `is_enabled`: the lockout is the boundary
        that bounds guessing, and a captcha that is off or unconfigured must
        not be what removes it. With the captcha off the refusal is a plain one
        and no token is involved; with it on, the lockout still holds.

        """
        return self._counters.is_limited(username, ip)

    def _chain(self) -> list[tuple[str, str, str]]:
        """Return the ordered (provider, site_key, secret_key) chain.

        Unknown provider names are dropped. A legacy scalar provider/site_key/
        secret_key stands in as a one-element chain when no per-provider table is
        set, so a config generated before the chain existed keeps working.

        """
        names = [name.strip().lower() for name in self.config.providers
                 if name.strip()]
        legacy = (self.config.provider or "").strip().lower()
        if not names:
            names = [legacy]
        chain: list[tuple[str, str, str]] = []
        for name in names:
            if name not in PROVIDER_SCRIPT:
                continue
            keys = self.config.keys.get(name)
            if keys is not None:
                chain.append((name, keys.site_key, keys.secret_key))
            elif name == legacy:
                chain.append((name, self.config.site_key,
                              self.config.secret_key))
            else:
                chain.append((name, "", ""))
        return chain

    def _active(self) -> tuple[str, str, str]:
        """Return the first chain entry that can actually be used.

        A provider is skipped when it has no key pair, and also when the health
        store has marked it unreachable. WHY one usable provider is still
        returned when all are unhealthy: rendering nothing would leave the
        challenge unanswerable, so the chain is not emptied by a transient outage
        that may have cleared by the time the user submits.

        """
        chain = self._chain()
        usable = [entry for entry in chain
                  if len(entry[1]) > 0 and len(entry[2]) > 0]
        for entry in usable:
            if self._health.is_healthy(entry[0]):
                return entry
        if usable:
            return usable[0]
        return chain[0] if chain else ("turnstile", "", "")

    def is_enabled(self) -> bool:
        """Return whether the captcha can be enforced at all.

        Mirrors the panel's `isCaptchaConfigured`: enabled, plus a usable key
        pair. With either missing the captcha is not demanded, so an
        unconfigured deployment is never locked out of its own login page.

        """
        _, site_key, secret_key = self._active()
        return bool(self.config.enabled) and len(site_key) > 0 \
            and len(secret_key) > 0

    def provider(self) -> str:
        """Return the active provider: the first chain entry that can be used."""
        return self._active()[0]

    def is_required(self, username: str, ip: str) -> bool:
        """Return whether this attempt must carry a valid captcha token.

        False below the threshold: this is the adaptivity that distinguishes
        the captcha from an always-on one.

        True on every attempt while the counters are degraded, and only then:
        the captcha is the only mechanism left to tax an attempt once the shared
        counter store is unreachable, so degrading to "no restriction" would
        hand the login form back to an attacker exactly when the lockout is no
        longer holding across the deployment. A deployment with no captcha
        configured has no token to demand, so the lockout refusal is its only
        answer and it is unchanged.

        """
        if not self.is_enabled():
            return False
        if self.degraded:
            return True
        return self._counters.count(username, ip) >= self.threshold()

    def threshold(self) -> int:
        """Return the number of failures before the captcha becomes mandatory.

        A negative or absurd threshold is clamped to a usable value: asking
        for a captcha from the very first attempt would turn the adaptive
        captcha into an always-on one and lock out every existing client.

        """
        return max(1, self.config.threshold)

    def verify(self, username: str, ip: str, token: str,
               provider: str = "") -> bool:
        """Return whether this attempt may proceed.

        The three ways through are: no captcha was demanded; a valid token
        came with the attempt; or the captcha is not configured. Anything else
        is refused, including a provider that could not be reached, which is
        the fail-closed behaviour the panel has.

        *provider* is the name the widget posted. A token is only meaningful to
        the provider that issued it, so when the chain shifted between the
        render and this call, verification still targets the right endpoint.

        """
        if not self.is_required(username, ip):
            return True
        name, _site_key, secret = self._active()
        requested = (provider or "").strip().lower()
        for entry in self._chain():
            if entry[0] == requested and len(entry[2]) > 0:
                name, secret = entry[0], entry[2]
                break
        try:
            verdict = self._verify(token, secret, name)
        except ProviderUnreachable:
            # WHY recorded and still refused: an unreachable provider is the
            # signal the chain fails over on, and the attempt is refused
            # fail-closed rather than let through.
            self._health.record_failure(name)
            return False
        if verdict:
            self._health.record_success(name)
        return verdict

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

        Mirrors the panel's login page: the marker class the provider's script
        scans for on the container, the site key in `data-sitekey`, and a
        callback that copies the solved token into the hidden `captchaToken`
        input so the form carries it back to the server.

        """
        if not self.is_enabled():
            return ""
        provider, site_key, _secret = self._active()
        return WIDGET_TEMPLATE % {
            "widget_class": PROVIDER_WIDGET_CLASS[provider],
            "script": PROVIDER_SCRIPT[provider],
            "site_key": site_key,
            "provider": provider,
        }

    def render_params(self, username: str = "", ip: str = "") -> dict:
        """Return the captcha facts a login template needs for this client.

        *username* is whatever the client has typed so far, which is empty on a
        fresh page load: the page can then only know whether the *address* is
        over the threshold, which is the same limit the admin panel applies when
        it has no username yet. A page reached from a refused login carries the
        username in its query, so the account's own counter is read here too.

        The secret is deliberately absent: templates render the site key, which
        is public by definition, and never the secret, which is not.

        """
        enabled = self.is_enabled()
        required = self.is_required(username, ip)
        provider, site_key, _secret = self._active()
        return {
            "captcha_enabled": enabled,
            "captcha_required": required,
            "captcha_provider": provider,
            "captcha_site_key": site_key if enabled else "",
            "captcha_script_url": self.widget_script(),
            # WHY the widget follows `required`, not `enabled`: the provider
            # script and its token round trip are third-party cost paid on every
            # page view, but the challenge is only ever demanded past the
            # threshold, so below it the page keeps no dependency on the provider.
            "captcha_widget": self.widget_html() if required else "",
        }


WIDGET_TEMPLATE = """<div class="captcha-widget">
<script>
function onCaptchaSuccess(token) {
    var field = document.querySelector("input[name=captchaToken]");
    if (field) { field.value = token; }
}
function onCaptchaExpired() {
    var field = document.querySelector("input[name=captchaToken]");
    if (field) { field.value = ""; }
}
</script>
<script src="%(script)s" async defer></script>
<div class="%(widget_class)s" data-sitekey="%(site_key)s" data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired" data-error-callback="onCaptchaExpired"></div>
<input type="hidden" name="captchaToken" value="">
<input type="hidden" name="captchaProvider" value="%(provider)s">
</div>"""


def is_loopback_client(ip: str) -> bool:
    """Return whether *ip* is a loopback address, as a string.

    Exposed for callers that want the panel's loopback exemption without
    reaching into the counters.

    """
    return is_loopback(ip)


def extract_provider(form: typing.Any) -> str:
    """Return the provider named by *form*, or an empty string.

    *form* is anything with a `get_argument(name, default)` method. The widget
    posts its own provider name so the token is verified by the provider that
    issued it, even if the chain shifted between render and submit.

    """
    value = form.get_argument("captchaProvider", "")
    return value.strip().lower() if isinstance(value, str) else ""


__all__ = ["Captcha", "LoginFailureCounters", "extract_provider",
           "is_loopback_client"]