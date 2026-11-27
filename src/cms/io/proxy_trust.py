"""Which requests may have their forwarded address believed.

ProxyFix reads the caller's chain and adopts it. That is only sound for a request a proxy
forwarded, and the origin cannot see that from the chain itself: a caller that reaches the
origin directly writes the same headers. The front proxy therefore stamps a marker on what it
forwards, and everything else keeps the address it connected from.

The marker lives in the environment, never in a committed file, so it is not a value a caller
can read out of the repository and replay.
"""

import hmac

PROXY_MARKER_ENVIRON = "HTTP_X_CMS_TRUSTED_PROXY"


def is_trusted_request(environ, marker):
    """Whether this request carries the marker the configured proxy stamps."""
    expected = (marker or "").strip()
    if not expected:
        return False
    presented = (environ.get(PROXY_MARKER_ENVIRON) or "").strip()
    return hmac.compare_digest(presented.encode(), expected.encode())


class TrustedProxyFix:
    """Applies ProxyFix only to a request the proxy marked.

    A request without the marker is passed through untouched, so REMOTE_ADDR stays the
    address it connected from. Failing closed matters more than a missing client address:
    an unmarked chain would let a caller clear a contest's IP restriction by claiming an
    allowed address, and choose the bucket its login attempts are counted in.
    """

    def __init__(self, app, num_proxies, marker):
        from werkzeug.middleware.proxy_fix import ProxyFix

        self.app = app
        self.marker = marker
        self.fix = ProxyFix(app, num_proxies)

    def __call__(self, environ, start_response):
        if is_trusted_request(environ, self.marker):
            return self.fix(environ, start_response)
        return self.app(environ, start_response)
