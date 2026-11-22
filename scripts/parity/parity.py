#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026
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

"""Capture HTTP responses from one CMS stack and diff two captures.

Three subcommands, one job each:

  config   write the cms.toml a stack boots with, from the shipped template
  capture  drive a running stack with the request list and record responses
  diff     normalise two captures and report every difference

Only `diff` decides pass or fail: it exits 0 when nothing differs, 1 when
something does, and 3 when a capture is unusable (a surface that answered 5xx or
an error page is not a response worth comparing, and comparing two identical
error pages is how an equivalence harness reports a false zero).

Normalisation is the whole soundness argument: a rule that is too broad hides a
real behaviour change, a rule that is missing turns every run into noise. Every
rule therefore lives in NORMALISERS with the observation that justifies it, and
nothing else in the file rewrites a body.
"""

import argparse
import email.utils
import http.client
import json
import os
import re
import sys
import urllib.parse

# Headers that carry behaviour. A header outside this set is not compared:
# `date` and `server` are the clock and the version, `content-length` follows
# the body we already compare, `set-cookie` values are per-session, `etag`
# encodes them.
MEANINGFUL_HEADERS = (
    "content-type",
    "location",
    "content-language",
    "cache-control",
)

# A body that contains one of these answered with an error, whatever its status
# says; two identical stack traces are not equivalence.
POISON = (
    "Traceback (most recent call last)",
    "Internal Server Error",
)

# One entry per per-run value actually observed to differ between two captures
# of the same tree. Each says what it rewrites and why the value cannot be a
# behaviour.
NORMALISERS = (
    (
        "xsrf-token",
        re.compile(r'name="_xsrf" value="[^"]*"'),
        'name="_xsrf" value="<xsrf>"',
        "Tornado mints the xsrf token per session from the cookie secret, so two "
        "sessions on one tree carry different tokens by construction.",
    ),
    (
        "xsrf-cookie",
        re.compile(r"_xsrf=[^;\"\s<]+"),
        "_xsrf=<xsrf>",
        "The same token mirrored in the cookie jar of the request that set it.",
    ),
    (
        "session-cookie",
        re.compile(r"\b(awslogin|[a-z0-9_]+_login)=\"[^\"]*\"|\b(awslogin|[a-z0-9_]+_login)=[^;\"\s<]+"),
        lambda m: "%s=<session>" % (m.group(1) or m.group(2)),
        "The login cookie embeds the login instant and a signature over it; "
        "it is a per-session value, and the pages it gates are compared by body.",
    ),
    (
        "epoch-clock",
        re.compile(r"\b1[6-9]\d{8}\.\d{1,9}\b"),
        "<epoch>",
        "Each page hands the browser the server's clock as an epoch second with a "
        "fraction (CMS.AWSUtils(url, 1795285510.94982, …) and its CWS twin) so the "
        "countdown runs client-side; that value is the instant of the request.",
    ),
    (
        "datetime",
        re.compile(r"\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b"),
        "<datetime>",
        "Any rendered calendar instant in these pages is either the fixed seed "
        "time or the instant of this request (last_login_at); the latter is a "
        "clock reading, not a behaviour.",
    ),
)


def normalise(text):
    """Apply every rule in NORMALISERS, in order."""
    for _, pattern, replacement, _why in NORMALISERS:
        text = pattern.sub(replacement, text)
    return text


class Jar:
    """A cookie jar with the one behaviour these pages need: keep Set-Cookie."""

    def __init__(self):
        self.cookies = {}

    def header(self):
        return "; ".join("%s=%s" % (k, v) for k, v in sorted(self.cookies.items()))

    def absorb(self, headers):
        for key, value in headers:
            if key.lower() != "set-cookie":
                continue
            name, _, rest = value.partition("=")
            self.cookies[name.strip()] = rest.split(";")[0]


def request(base_url, method, path, form=None, jar=None, extra_headers=None):
    """Perform one HTTP request and return (status, headers, body_text)."""
    parsed = urllib.parse.urlsplit(base_url)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
    headers = {"Host": parsed.netloc, "Connection": "close"}
    if extra_headers:
        headers.update(extra_headers)
    body = None
    if form is not None:
        body = urllib.parse.urlencode(form)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    cookie = jar.header() if jar else ""
    if cookie:
        headers["Cookie"] = cookie
    target = path
    conn.request(method, target, body=body, headers=headers)
    response = conn.getresponse()
    payload = response.read()
    pairs = response.getheaders()
    status = response.status
    conn.close()
    if jar is not None:
        jar.absorb(pairs)
    text = payload.decode("utf-8", "replace")
    return status, pairs, text


def header_dict(pairs):
    out = {}
    for key, value in pairs:
        out.setdefault(key.lower(), value)
    return out


def check_expectations(entry, status, headers, body):
    """Return a list of failures for one recorded response."""
    expect = entry.get("expect") or {}
    failures = []
    if "status" in expect and status != expect["status"]:
        failures.append("status %d, expected %d" % (status, expect["status"]))
    for needle in expect.get("body_contains", ()):
        if needle not in body:
            failures.append("body is missing %r" % needle)
    for needle in expect.get("body_not_contains", ()):
        if needle in body:
            failures.append("body contains forbidden %r" % needle)
    for needle in expect.get("location_contains", ()):
        if needle not in headers.get("location", ""):
            failures.append("Location %r is missing %r"
                            % (headers.get("location", ""), needle))
    for needle in expect.get("location_not_contains", ()):
        if needle in headers.get("location", ""):
            failures.append("Location %r contains forbidden %r"
                            % (headers.get("location", ""), needle))
    if status >= 500:
        failures.append("answered %d" % status)
    for needle in POISON:
        if needle in body:
            failures.append("body contains %r" % needle)
    return failures


def cmd_config(args):
    with open(args.source, encoding="utf-8") as handle:
        text = handle.read()

    # WHY: the shipped cms-devdb.toml carries the published default secret, and
    # cms/conf.py refuses to boot on it, so the harness must set its own.
    text = re.sub(r'(?m)^secret_key = "[^"]*"$',
                  'secret_key = "%s"' % args.secret, text, count=1)
    text = re.sub(r'(?m)^url = "[^"]*"$',
                  'url = "%s"' % args.database_url, text, count=1)
    # WHY: every service in this stack shares one container, so an empty
    # [rpc] secret would make the services refuse each other's calls.
    text = re.sub(r'(?m)^\[rpc\]$',
                  '[rpc]\nsecret = "%s"' % args.rpc_secret, text, count=1)
    # WHY: the ranking web server is not on the parity surface, and a
    # configured ranking target would make ProxyService retry a host that
    # does not exist in this network.
    text = re.sub(r"(?m)^rankings = \[[^\]]*\]$", "rankings = []", text)
    # WHY: two stacks run on the same network, and a shared service hostname
    # would let one stack's RPC clients reach the other stack's services.
    text = re.sub(r'(?m)^(\w+) = \[\["cms-', r'\1 = [["cms-%s-' % args.stack,
                  text)

    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(text)


def cmd_capture(args):
    with open(args.requests, encoding="utf-8") as handle:
        spec = json.load(handle)

    bases = {"cws": args.cws_url, "aws": args.aws_url}
    jars = {}
    recorded = []
    failures = []

    for entry in spec["requests"]:
        stack = entry["stack"]
        jar = jars.setdefault(stack, Jar())
        method = entry.get("method", "GET")
        path = entry.get("path", "")
        form = entry.get("form")

        if "login" in entry:
            login = entry["login"]
            _, _, body = request(bases[stack], "GET", login["get"], None, jar)
            token = jar.cookies.get("_xsrf")
            match = re.search(r'name="_xsrf" value="([^"]+)"', body)
            if match:
                token = match.group(1)
            if not token:
                failures.append("%s: no xsrf token on %s" % (entry["id"], login["get"]))
            form = dict(login["fields"])
            form["_xsrf"] = token or ""
            method = "POST"
            path = login["post"]

        status, pairs, body = request(bases[stack], method, path, form, jar)
        headers = header_dict(pairs)
        failures.extend("%s: %s" % (entry["id"], failure)
                        for failure in check_expectations(entry, status, headers, body))
        recorded.append({
            "id": entry["id"],
            "surface": entry["surface"],
            "stack": stack,
            "method": method,
            "path": path,
            "status": status,
            "headers": {name: headers.get(name) for name in MEANINGFUL_HEADERS},
            "cookies": sorted(jars[stack].cookies),
            "body_len": len(body.encode("utf-8")),
            "body": body,
        })

    document = {
        "stack": args.stack,
        "bases": bases,
        "requests": recorded,
    }
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "capture.json"), "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)

    surfaces = sorted({item["surface"] for item in recorded})
    print("parity: stack=%s recorded=%d surfaces=%s"
          % (args.stack, len(recorded), ",".join(surfaces)))
    if failures:
        for failure in failures:
            print("parity: EXPECTATION %s" % failure, file=sys.stderr)
        return 3
    return 0


def first_difference(left, right):
    """Return a one-line sighting of where two normalised bodies diverge."""
    left_lines = left.splitlines()
    right_lines = right.splitlines()
    for index, (a, b) in enumerate(zip(left_lines, right_lines)):
        if a != b:
            return "line %d: %r != %r" % (index + 1, a.strip()[:200], b.strip()[:200])
    if len(left_lines) != len(right_lines):
        return "line count %d != %d" % (len(left_lines), len(right_lines))
    return "bodies differ after normalisation"


def load_capture(path):
    with open(os.path.join(path, "capture.json"), encoding="utf-8") as handle:
        return json.load(handle)


def cmd_diff(args):
    left = load_capture(args.a)
    right = load_capture(args.b)
    if not left["requests"] or not right["requests"]:
        print("parity: refusing to diff an empty capture (%s=%d, %s=%d)"
              % (left["stack"], len(left["requests"]),
                 right["stack"], len(right["requests"])), file=sys.stderr)
        return 3

    left_by_id = {item["id"]: item for item in left["requests"]}
    right_by_id = {item["id"]: item for item in right["requests"]}
    order = [item["id"] for item in left["requests"]]

    diffs = []
    counts = {"status": 0, "headers": 0, "body": 0, "missing": 0}

    for request_id in order:
        a = left_by_id.get(request_id)
        b = right_by_id.get(request_id)
        if b is None:
            counts["missing"] += 1
            diffs.append({"id": request_id, "kind": "missing", "detail": "absent from candidate"})
            continue
        entry = {"id": request_id, "surface": a["surface"], "kind": [], "detail": []}
        if a["status"] != b["status"]:
            counts["status"] += 1
            entry["kind"].append("status")
            entry["detail"].append("status %d != %d" % (a["status"], b["status"]))
        for name in MEANINGFUL_HEADERS:
            if (a["headers"].get(name) or "") != (b["headers"].get(name) or ""):
                counts["headers"] += 1
                entry["kind"].append("headers")
                entry["detail"].append("header %s: %r != %r"
                                       % (name, a["headers"].get(name),
                                          b["headers"].get(name)))
        if a["cookies"] != b["cookies"]:
            counts["headers"] += 1
            entry["kind"].append("headers")
            entry["detail"].append("cookie names %s != %s" % (a["cookies"], b["cookies"]))
        left_body = normalise(a["body"])
        right_body = normalise(b["body"])
        if left_body != right_body:
            counts["body"] += 1
            entry["kind"].append("body")
            entry["detail"].append(first_difference(left_body, right_body))
        if entry["kind"]:
            diffs.append(entry)

    for request_id in right_by_id:
        if request_id not in left_by_id:
            counts["missing"] += 1
            diffs.append({"id": request_id, "kind": "missing", "detail": "absent from baseline"})

    total = len(diffs)
    document = {
        "baseline": left["stack"],
        "candidate": right["stack"],
        "compared": len(order),
        "diff": total,
        "counts": counts,
        "entries": diffs,
    }
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=1, sort_keys=True)

    for entry in diffs:
        print("parity: DIFF %s [%s] %s"
              % (entry["id"], ",".join(entry["kind"]),
                 "; ".join(entry["detail"])))
    print("parity: compared=%d diff=%d status=%d headers=%d body=%d missing=%d"
          % (len(order), total, counts["status"], counts["headers"],
             counts["body"], counts["missing"]))
    return 0 if total == 0 else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    config = sub.add_parser("config", help="render a stack's cms.toml")
    config.add_argument("--source", required=True)
    config.add_argument("--out", required=True)
    config.add_argument("--stack", required=True)
    config.add_argument("--secret", required=True)
    config.add_argument("--rpc-secret", required=True)
    config.add_argument("--database-url", required=True)
    config.set_defaults(func=cmd_config)

    capture = sub.add_parser("capture", help="record a running stack")
    capture.add_argument("--requests", required=True)
    capture.add_argument("--stack", required=True)
    capture.add_argument("--cws-url", required=True)
    capture.add_argument("--aws-url", required=True)
    capture.add_argument("--out", required=True)
    capture.set_defaults(func=cmd_capture)

    diff = sub.add_parser("diff", help="compare two captures")
    diff.add_argument("--a", required=True)
    diff.add_argument("--b", required=True)
    diff.add_argument("--json")
    diff.set_defaults(func=cmd_diff)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
