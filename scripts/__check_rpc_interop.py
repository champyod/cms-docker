#!/usr/bin/env python3
"""Proves the Rust LogService and the Python CMS client speak the same protocol.

The Rust side is tested against itself everywhere else in the tree. That cannot
show whether the code the Python services actually use — `cms.io.rpc`, the
client that dials a service and expects `__id` echo, `__data`, `__error` and the
configured secret — agrees with it. This script starts the Rust binary and drives
it with the real client, so a divergence in the envelope, the secret check or the
ring buffer fails here instead of during a service swap.

It needs a Python environment that can import `cms` (gevent, sqlalchemy<1.4,
psycopg2, tornado<5, babel, werkzeug, bcrypt, chardet, netifaces, pycryptodomex).
The repository's own pinned set is in `src/pyproject.toml`. Build it with:

    uv venv /tmp/cms-interop --python 3.11
    uv pip install --python /tmp/cms-interop/bin/python \\
        "tornado==4.5.3" "sqlalchemy>=1.3,<1.4" "gevent==25.8.1" \\
        "greenlet>=3.0rc1" "werkzeug==3.1.5" "babel==2.12.1" \\
        "bcrypt>=3.1,<4.4" "chardet>=3.0,<5.3" "netifaces>=0.10,<0.12" \\
        "pycryptodomex==3.23.0" "psutil>=5.5,<7.1" "requests==2.32.3" \\
        "psycopg2-binary==2.9.10"

Then, from the repository root:

    /tmp/cms-interop/bin/python scripts/__check_rpc_interop.py

Exit 0 means the two agree. Any other answer prints the specific disagreement.

Two setup facts this script depends on, both learned the hard way:
- the client resolves the service address from `[services] LogService` in
  `cms.toml`, so the binary must bind the port that table names;
- `cms.conf` refuses to load while `web_server.secret_key` is the shipped
  default, and `cms.io.rpc` reads the RPC secret from the same file, so the
  binary must be given that value — not a placeholder of this script's choosing.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time

REPOSITORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.environ.get(
    "CMS_LOG_SERVICE_BIN",
    os.path.join(REPOSITORY, "backend", "target", "debug", "cms-log-service"),
)
READY_TIMEOUT_SECONDS = 15


def configured_port() -> int:
    """The port the client will dial, taken from the config it reads itself.

    The client resolves the service address from `[services] LogService`, so a
    port of this script's own choosing would fail to connect for a reason that
    has nothing to do with the protocol.
    """
    from cms import ServiceCoord, config

    return config.services[ServiceCoord("LogService", 0)].port


def raw_call(port: int, payload: dict) -> dict:
    """Sends one framed message and reads the one reply it is owed."""
    with socket.create_connection(("127.0.0.1", port), timeout=10) as sock:
        sock.sendall(json.dumps(payload).encode() + b"\r\n")
        return json.loads(sock.makefile("rb").readline())


def wait_for_listening(process: subprocess.Popen, port: int) -> str:
    """Reads the binary's bind line, so a wrong port fails here and not later."""
    stdout = process.stdout
    if stdout is None:
        raise SystemExit("the binary's stdout was not piped, so it cannot report its port")
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        line = stdout.readline()
        if not line:
            break
        if "listening on" in line:
            return line.strip()
    raise SystemExit(f"the binary never reported listening on port {port}")


def main() -> int:
    sys.path.insert(0, os.path.join(REPOSITORY, "src"))
    if "CMS_CONFIG" not in os.environ:
        raise SystemExit(
            "CMS_CONFIG must point at a cms.toml whose web_server.secret_key is "
            "not the shipped default; cms.conf refuses to load otherwise"
        )

    from cms import ServiceCoord
    from cms.io.rpc import RemoteServiceClient, _get_rpc_secret

    secret = _get_rpc_secret()
    if not secret:
        raise SystemExit("cms.toml configures no [rpc] secret, so nothing can authenticate")

    port = configured_port()
    workspace = tempfile.mkdtemp(prefix="cms-interop-")
    environment = dict(os.environ)
    environment.update({
        "LOG_SERVICE_ADDR": f"127.0.0.1:{port}",
        "RPC_SECRET": secret,
        "LOG_DIR": workspace,
    })

    server = subprocess.Popen(
        [BINARY], env=environment,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    failures = []
    try:
        greeting = wait_for_listening(server, port)
        print(f"binary: {greeting}")

        client = RemoteServiceClient(ServiceCoord("LogService", 0))
        client.connect()
        if not client.wait_for_connection(timeout=10):
            failures.append("the Python client never connected")
            return report(failures)
        print("client: connected")

        client.Log(msg="interop warning", levelname="WARNING", levelno=30,
                   created=1700000000.0, service_name="Worker", service_shard=3,
                   operation="compile", exc_text=None).get(timeout=10)
        client.Log(msg="interop info", levelname="INFO", levelno=20,
                   created=1700000000.0).get(timeout=10)
        print("client: two records answered")

        messages = client.last_messages().get(timeout=10) or []
        expected = {
            "message": "interop warning",
            "coord": "Worker,3",
            "operation": "compile",
            "severity": "WARNING",
            "timestamp": 1700000000.0,
            "exc_text": None,
        }
        if len(messages) != 1:
            failures.append(f"expected the one warning buffered, got {len(messages)} entries")
        else:
            for key, want in expected.items():
                got = messages[0].get(key)
                if got != want:
                    failures.append(f"{key}: expected {want!r}, got {got!r}")
            if set(messages[0]) != set(expected):
                failures.append(
                    f"entry keys: expected {sorted(expected)}, got {sorted(messages[0])}"
                )

        refusal = raw_call(port, {"__id": "a", "__method": "last_messages",
                                  "__data": {}, "__secret": "wrong"})
        if refusal.get("__error") != "RPC authentication failed.":
            failures.append(f"a wrong secret was answered with {refusal.get('__error')!r}")
        if refusal.get("__id") != "a":
            failures.append("the refusal did not echo __id")

        unknown = raw_call(port, {"__id": "b", "__method": "no_such_method",
                                  "__data": {}, "__secret": secret})
        if "doesn't exist" not in (unknown.get("__error") or ""):
            failures.append(f"an unknown method was answered with {unknown.get('__error')!r}")

        still = raw_call(port, {"__id": "c", "__method": "last_messages",
                                "__data": {}, "__secret": secret})
        if len(still.get("__data") or []) != 1:
            failures.append(f"the host stopped answering after two refusals: {still!r}")

        logs = os.path.join(workspace, "cms")
        written = sorted(os.listdir(logs)) if os.path.isdir(logs) else []
        if not written:
            failures.append("no log file was written")
        if "last.log" in written:
            target = os.readlink(os.path.join(logs, "last.log"))
            if target not in written:
                failures.append(f"last.log points at {target!r}, which is not in {written}")
        print(f"files: {written}")

        client.disconnect()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()

    return report(failures)


def report(failures: list) -> int:
    if not failures:
        print("RESULT: PASS")
        return 0
    for failure in failures:
        print(f"FAIL: {failure}")
    print("RESULT: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
