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

from cms.conf import CaptchaConfig


logger = logging.getLogger(__name__)


# panel: captcha.ts posts to these, the login page loads these scripts.
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify"
PROVIDER_SCRIPT = {
    "turnstile": "https://challenges.cloudflare.com/turnstile/v0/api.js",
    "hcaptcha": "https://hcaptcha.com/1/api.js",
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


def verify_token(token: str, secret: str, config: CaptchaConfig) -> bool:
    """Return whether *token* is a valid answer for the configured provider.

    The request and the fail-closed treatment of a network error follow
    `captcha.ts`: a POST of `secret` and `response` as form data, and any
    exception on the way out of the process returns False rather than
    letting an unverifiable token through.

    """
    if len(token) == 0:
        return False
    provider = (config.provider or "").strip().lower()
    url = HCAPTCHA_VERIFY_URL if provider == "hcaptcha" else TURNSTILE_VERIFY_URL
    payload = urllib.parse.urlencode({"secret": secret, "response": token})
    try:
        with urllib.request.urlopen(url, data=payload.encode("utf-8"),
                                    timeout=VERIFY_TIMEOUT) as answer:
            body = answer.read()
    except (urllib.error.URLError, OSError, ValueError):
        # WHY fail closed: an unreachable provider must not become a way to
        # skip the captcha, so this is logged loudly and refused.
        logger.warning("Could not reach the %s siteverify endpoint; refusing "
                       "the login attempt.", provider or "turnstile")
        return False
    return _is_successful_answer(body, provider)


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
