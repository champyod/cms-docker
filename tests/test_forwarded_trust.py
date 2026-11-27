#!/usr/bin/env python3
"""The origin believes a forwarded address only from a marked request.

A contest's IP restriction and the login rate limiter both read the client address. The
origin adopts that address from the caller's own forwarded header whenever a proxy is
configured, so a request that reaches the origin directly could name itself an allowed
participant address and clear the restriction. This asserts the gate that stands in front of
that read: the header counts only when the front proxy stamped its marker.

Runs under `env -i` with no third-party packages, so it imports the module it tests rather
than the service that needs werkzeug at import time.
"""

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO_ROOT / "src" / "cms" / "io" / "proxy_trust.py"

# Loaded by path rather than as `cms.io.proxy_trust`: the package initializer imports the
# whole core stack (gevent, SQLAlchemy), and this suite runs under `env -i` with none of it.
# The module under test has no such dependency, so the surface stays the real code.
_spec = importlib.util.spec_from_file_location("cms.io.proxy_trust", MODULE_PATH)
proxy_trust = importlib.util.module_from_spec(_spec)
sys.modules["cms.io.proxy_trust"] = proxy_trust
_spec.loader.exec_module(proxy_trust)

PROXY_MARKER_ENVIRON = proxy_trust.PROXY_MARKER_ENVIRON
is_trusted_request = proxy_trust.is_trusted_request

MARKER = "suite-marker"
PEER = "172.18.0.5"
CLAIMED = "203.0.113.7"

passed = 0
failed = 0


def ok(name: str) -> None:
    global passed
    passed += 1
    print(f"  ok   {name}")


def no(name: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL {name}")


def environ(presented=None):
    env = {
        "REQUEST_METHOD": "GET",
        "REMOTE_ADDR": PEER,
        "HTTP_X_FORWARDED_FOR": CLAIMED,
    }
    if presented is not None:
        env[PROXY_MARKER_ENVIRON] = presented
    return env


def resolved(presented, configured):
    """The address the application finally sees for one request.

    The adopted-address outcome is modelled here, because the adopting half is werkzeug's
    ProxyFix and werkzeug is not installed under `env -i`. What this asserts is the gate in
    front of it: ProxyFix is applied exactly when this predicate says so, so the predicate
    deciding correctly is what keeps an unmarked chain out.
    """
    env = environ(presented)
    return CLAIMED if is_trusted_request(env, configured) else env["REMOTE_ADDR"]


print("a marked request may name its address through the chain")
if resolved(MARKER, MARKER) == CLAIMED:
    ok("the forwarded chain is adopted when the marker matches")
else:
    no("the forwarded chain is adopted when the marker matches")

print("an unmarked request keeps the address it connected from")
if resolved(None, MARKER) == PEER:
    ok("a request with no marker keeps its peer address")
else:
    no("a request with no marker keeps its peer address")
if resolved("", MARKER) == PEER:
    ok("an empty marker is refused")
else:
    no("an empty marker is refused")
if resolved(MARKER + "-suffix", MARKER) == PEER:
    ok("a marker that merely starts with the right value is refused")
else:
    no("a marker that merely starts with the right value is refused")

print("an unconfigured origin trusts nothing")
if resolved(MARKER, "") == PEER:
    ok("an empty configured marker refuses every chain")
else:
    no("an empty configured marker refuses every chain")
if resolved(MARKER, None) == PEER:
    ok("an absent configured marker refuses every chain")
else:
    no("an absent configured marker refuses every chain")

print("the predicate is the gate the middleware uses")
if is_trusted_request(environ(MARKER), MARKER) is True:
    ok("a matching marker is trusted")
else:
    no("a matching marker is trusted")
if is_trusted_request(environ("other"), MARKER) is False:
    ok("a different marker is not trusted")
else:
    no("a different marker is not trusted")

print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
