"""Talking to the CAPTCHA provider, and reading the token off a request.

Split out of captcha.py so each file stays readable: this one owns the network
and the field names, the other owns the decision to demand a challenge.
"""

import json
import logging
import typing
import urllib.error
import urllib.parse
import urllib.request


logger = logging.getLogger(__name__)


class ProviderUnreachable(Exception):
    """The provider's siteverify could not be reached, or answered uselessly.

    Distinct from a refused token: it is the signal the chain's health tracking
    uses to skip a provider, so it is raised rather than folded into a False.

    """

    def __init__(self, provider: str) -> None:
        super().__init__(provider)
        self.provider = provider


# panel: captcha.ts posts to these, the login page loads these scripts.
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify"
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
PROVIDER_SCRIPT = {
    "turnstile": "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "hcaptcha": "https://hcaptcha.com/1/api.js",
    "recaptcha": "https://www.google.com/recaptcha/api.js",
}

# The class each provider's script scans for when it auto-renders. The provider
# NAME is not the class: Turnstile looks for `cf-turnstile`, hCaptcha for
# `h-captcha` and reCAPTCHA for `g-recaptcha`, so interpolating the name leaves
# the container inert.
PROVIDER_WIDGET_CLASS = {
    "turnstile": "cf-turnstile",
    "hcaptcha": "h-captcha",
    "recaptcha": "g-recaptcha",
}

# Each provider's own siteverify endpoint; every one takes `secret` and
# `response` as a form POST, so only the URL differs. An unknown provider falls
# back to Turnstile, matching how captcha.py's provider() resolves one.
PROVIDER_VERIFY_URL = {
    "turnstile": TURNSTILE_VERIFY_URL,
    "hcaptcha": HCAPTCHA_VERIFY_URL,
    "recaptcha": RECAPTCHA_VERIFY_URL,
}

# The panel's extractCaptchaToken accepts a token under any of these field
# names, because each provider's widget injects its own hidden input and the
# panel also accepts a plain `captchaToken`. Accepting the same set here means a
# client idiom that works against the panel works against these servers too.
TOKEN_FIELDS = (
    "captchaToken",
    "cf-turnstile-response",
    "h-captcha-response",
    "g-recaptcha-response",
)

# A provider that is slow to answer must not hold a login request open
# indefinitely: the caller sees a rejected captcha instead.
VERIFY_TIMEOUT = 10


def verify_token(token: str, secret: str, provider: str) -> bool:
    """Return whether *token* is a valid answer for *provider*.

    The request and the fail-closed treatment of a network error follow
    `captcha.ts`: a POST of `secret` and `response` as form data, and any
    exception on the way out of the process returns False rather than
    letting an unverifiable token through.

    *provider* names the siteverify endpoint, because a token is only
    meaningful to the provider that issued it and the chain may have shifted
    between the render that produced it and this call.

    """
    if len(token) == 0:
        return False
    normalized = (provider or "").strip().lower()
    url = PROVIDER_VERIFY_URL.get(normalized, TURNSTILE_VERIFY_URL)
    payload = urllib.parse.urlencode({"secret": secret, "response": token})
    try:
        with urllib.request.urlopen(url, data=payload.encode("utf-8"),
                                    timeout=VERIFY_TIMEOUT) as answer:
            body = answer.read()
    except (urllib.error.URLError, OSError, ValueError):
        # WHY raise instead of returning False: an unreachable provider is the
        # failover signal, and the caller still refuses the attempt fail-closed;
        # raising keeps that apart from a token the provider actually rejected.
        logger.warning("Could not reach the %s siteverify endpoint; refusing "
                       "the login attempt.", normalized or "turnstile")
        raise ProviderUnreachable(normalized or "turnstile")
    return _is_successful_answer(body, normalized)


def _is_successful_answer(body: bytes, provider: str) -> bool:
    """Return whether a siteverify response body reports success."""
    try:
        return json.loads(body.decode("utf-8")).get("success") is True
    except (UnicodeDecodeError, ValueError, AttributeError):
        # WHY not raise: an unparseable answer is a failed verification, and a
        # malformed response must not turn into a 500 on the login page.
        logger.warning("Unreadable answer from the %s siteverify endpoint.",
                       provider or "turnstile")
        return False


def extract_token(form: typing.Mapping[str, typing.Any]) -> str:
    """Return the captcha token carried by *form*, or an empty string.

    *form* is anything with a `get_argument(name, default)` method, which
    covers a tornado request handler and the test suite's stand-in.

    """
    for field in TOKEN_FIELDS:
        value = form.get_argument(field, "")
        if isinstance(value, str) and len(value.strip()) > 0:
            return value.strip()
    return ""
