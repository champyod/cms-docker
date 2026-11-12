#!/usr/bin/env python3
"""Regenerate tests/fixtures/fleet_parity.json from the Python collector.

The Python tool at ~/.hermes/scripts/sec-daily is the reference implementation.
This script stubs two seams only — `_run` (the commands it would execute) and
`datetime.now` (so the 30h scan rule has a fixed clock) — then records what the
real `collect()` and `as_lines()` produce for that input. Nothing is hand-written
into the expectation: if the Rust side disagrees, the Rust side is wrong.

The ssh command is the exception, and only as a key: the Rust probe reads the
scanner's published result file, so the fixture is keyed on that script. The
lines it expects are still whatever the Python collector printed for the
scripted answers, which are the older `<timestamp>|<count>` scan facts.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

TOOL = Path.home() / ".hermes/scripts/sec-daily"
sys.path.insert(0, str(TOOL))

import seclib.fleet_state as fleet  # noqa: E402

HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 11, 12, 9, 0, 0, tzinfo=timezone.utc)
HOSTS_RAW = "como-main=com-o@100.114.35.41:~/.ssh/cms_deploy,admin=root@10.0.0.9,cms=root@10.0.0.10"


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz is not None else NOW.replace(tzinfo=None)


def probe(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def probe_script() -> str:
    """The command the Rust tool sends, read from the crate so the key cannot drift."""
    source = (HERE.parents[1] / "src/fleet_state/probe.rs").read_text()
    head = 'pub const PROBE: &str = r#"'
    start = source.index(head) + len(head)
    return source[start:source.index('"#;', start)]


PROBE = probe_script()


RESPONSES = [
    {
        "argv": ["git", "-C", "{hub}/cms-docker-major", "log", "-1", "--format=%h|%cr|%s"],
        "cwd": None,
        "text": "a57f0856|2 days ago|Merge remote landed work into the board update and refresh the constraints snapshot\n",
    },
    {
        "argv": ["git", "-C", "{hub}/cms-docker-major", "rev-parse", "--abbrev-ref", "HEAD"],
        "cwd": None,
        "text": "major/admin-panel\n",
    },
    {
        "argv": ["git", "-C", "{hub}/cms-docker-major", "status", "--porcelain"],
        "cwd": None,
        "text": " M src/constraints.txt\n?? notes/scratch.md\n",
    },
    {
        "argv": ["gh", "run", "list", "--branch", "major/admin-panel", "--limit", "3",
                 "--json", "conclusion,displayTitle,createdAt"],
        "cwd": "{hub}/cms-docker-major",
        "text": json.dumps([
            {"conclusion": "success", "displayTitle": "feat(security): announce every completed rootfs scan finding", "createdAt": "2026-11-10T10:00:00Z"},
            {"conclusion": "failure", "displayTitle": "older run", "createdAt": "2026-11-09T10:00:00Z"},
        ]),
    },
    {
        "argv": ["gh", "pr", "list", "--state", "open", "--limit", "20", "--json", "number,title"],
        "cwd": "{hub}/cms-docker-major",
        "text": json.dumps([
            {"number": 12, "title": "Sync constraints and src/ with upstream CMS to fix pip Resolvable conflicts"},
            {"number": 14, "title": "Second open PR"},
        ]),
    },
    {
        "argv": ["git", "-C", "{hub}/cms-learn", "log", "-1", "--format=%h|%cr|%s"],
        "cwd": None,
        "text": "4dad914|2 weeks ago|name this repo's lanes learn/<area>/<topic>\n",
    },
    {
        "argv": ["git", "-C", "{hub}/cms-learn", "rev-parse", "--abbrev-ref", "HEAD"],
        "cwd": None,
        "text": "main\n",
    },
    {"argv": ["git", "-C", "{hub}/cms-learn", "status", "--porcelain"], "cwd": None, "text": ""},
    {
        "argv": ["gh", "run", "list", "--branch", "main", "--limit", "3",
                 "--json", "conclusion,displayTitle,createdAt"],
        "cwd": "{hub}/cms-learn",
        "text": "__error__ FileNotFoundError: No such file or directory: 'gh'",
    },
    {
        "argv": ["gh", "pr", "list", "--state", "open", "--limit", "20", "--json", "number,title"],
        "cwd": "{hub}/cms-learn",
        "text": "__error__ FileNotFoundError: No such file or directory: 'gh'",
    },
    {
        "argv": ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 "-o", "StrictHostKeyChecking=accept-new", "-i", "~/.ssh/cms_deploy",
                 "com-o@100.114.35.41", PROBE],
        "cwd": None,
        "text": probe(
            "kernel=5.15.0-203-generic",
            "reboot=required",
            "secupdates=4",
            "disk=38",
            "containers=36",
            "unhealthy=1",
            "restarting=0",
            "uptime=169830",
            "lastscan=2026-11-12T03:00:20Z|13357",
            "cms_backup_stale 0",
            "cms_backup_last_success_timestamp_seconds 1.762900000e+09",
            "cms_offsite_stale 1",
        ),
    },
    {
        "argv": ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 "-o", "StrictHostKeyChecking=accept-new", "root@10.0.0.9", PROBE],
        "cwd": None,
        "text": "__error__ TimeoutExpired: Command 'ssh' timed out after 25 seconds",
    },
    {
        "argv": ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 "-o", "StrictHostKeyChecking=accept-new", "root@10.0.0.10", PROBE],
        "cwd": None,
        "text": probe(
            "kernel=5.15.0-203-generic",
            "reboot=no",
            "secupdates=0",
            "disk=71",
            "containers=12",
            "unhealthy=0",
            "restarting=0",
            "uptime=900",
            "lastscan=2026-11-11T01:00:00Z|900",
        ),
    },
]

WAIVERS = {
    "waivers": [
        {"id": "W-1", "reviewBy": "2026-10-01"},
        {"id": "W-2", "reviewBy": "2027-01-31"},
        {"id": "W-3", "reviewBy": "2026-12-15T00:00:00Z"},
        {"id": "W-4"},
        {"id": "W-5", "reviewBy": "soon"},
    ]
}

HUB = str(fleet.HUB)


def canonical(value: str) -> str:
    return value.replace(HUB, "{hub}").replace(str(Path.home()), "~")


def key(argv, cwd):
    return (tuple(canonical(a) for a in argv), canonical(str(cwd)) if cwd else "")


def main() -> int:
    index = {key(r["argv"], r["cwd"]): r["text"] for r in RESPONSES}
    if len(index) != len(RESPONSES):
        raise SystemExit("duplicate command key in RESPONSES")
    used = set()

    def fake_run(cmd, cwd=None, timeout=20):  # noqa: ARG001 - the seam, not the contract
        k = key(cmd, cwd)
        if k not in index:
            raise SystemExit(f"unscripted command: {k[0]} cwd={k[1]}")
        used.add(k)
        return index[k]

    tmp = Path(tempfile.mkdtemp(prefix="fleet-parity-"))
    (tmp / "cms-docker-major/security").mkdir(parents=True)
    (tmp / "cms-docker-major/security/waivers.json").write_text(json.dumps(WAIVERS))
    fleet.HUB = tmp
    # The ssh command is what the Rust tool sends; the collector only interpolates it, so the
    # answers and the lines it prints are still the reference implementation's.
    fleet.PROBE = PROBE
    fleet._run = fake_run
    fleet.datetime = FixedDateTime
    os.environ[fleet.HOSTS_ENV] = HOSTS_RAW

    state = fleet.collect()
    repo_lines, server_lines = fleet.as_lines(state)

    unused = set(index) - used
    if unused:
        raise SystemExit(f"unused scripted commands: {sorted(unused)}")

    fields = ("host", "kernel", "reboot", "secupdates", "disk", "containers", "unhealthy",
              "restarting", "uptime", "lastscan", "cms_backup_stale", "cms_offsite_stale", "error")
    payload = {
        "_note": "generated by regen_fleet_parity.py from the Python collector; do not hand-edit",
        "now": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hosts_env": HOSTS_RAW,
        "waivers_json": WAIVERS,
        "responses": RESPONSES,
        "expected": {
            "repo_lines": repo_lines,
            "server_lines": server_lines,
            "errors": state["errors"],
            "uncovered": state["uncovered"],
            "repo_subjects": [r.get("subject") for r in state["repos"]],
            "servers": [{f: s.get(f) for f in fields} for s in state["servers"]],
        },
    }
    out = HERE / "fleet_parity.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")
    print("\n".join(repo_lines))
    print("\n".join(server_lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
