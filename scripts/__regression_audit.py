#!/usr/bin/env python3
"""Mechanical regression audit for cms-docker: catches the failure classes
that produced P1-P5 (stale paths, exec-bit loss, CLI drift, profile-graph
gaps, bind-mount perms)."""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

os.chdir(Path(__file__).resolve().parent.parent)

issues, checks, skipped = [], 0, 0

def track(msg):
    issues.append(msg)

# ---------- sources to scan for path references ----------
SCAN_FILES = ["cms", "Makefile", "README.md"] \
    + [f"scripts/{f}" for f in os.listdir("scripts") if f.endswith(".sh")] \
    + ["docker-compose.yml"]
scan_files = [f for f in SCAN_FILES if os.path.isfile(f)]

PATH_RE = re.compile(r'(?:scripts|config|examples|docker|backups)/[A-Za-z0-9_./-]+')
COMPOSE_MOUNT_RE = re.compile(r"- \./([^\s:]+):(/[^:\s]+)(?::ro)?\s*$", re.M)
compose: str = open("docker-compose.yml", errors="replace").read()


def git_ignored(paths: set[str]) -> set[str]:
    if not paths:
        return set()
    proc = subprocess.run(["git", "check-ignore", "--stdin"],
                          input="\n".join(sorted(paths)),
                          capture_output=True, text=True)
    return {p[2:] if p.startswith("./") else p for p in proc.stdout.split()}


# WHY: a path git is told to ignore is an operator or runtime artefact that is
# supposed to be absent on a clean checkout (config/cms.toml, config/
# funnel.htpasswd, config/mtls/*.pem, ...). Reporting those made every
# unbootstrapped clone fail the gate, which is the same as having no gate.
# One batched `check-ignore` for the whole run rather than a subprocess per
# path, and no hardcoded allowlist that would rot on the next operator file.
IGNORED = git_ignored(
    {m.rstrip('."\'').rstrip("/")
     for f in scan_files
     for m in PATH_RE.findall(open(f, errors="replace").read())}
    | {m.group(1) for m in COMPOSE_MOUNT_RE.finditer(compose)})

print("== A. stale-path audit ==")
for f in scan_files:
    text = open(f, errors="replace").read()
    for m in set(PATH_RE.findall(text)):
        checks += 1
        p = m.rstrip('."\'').rstrip("/")
        if p.endswith((".sh", ".sql", ".py", ".yaml", ".yml", ".toml")) or "/" in p[len(p.split("/")[0])+1:]:
            if not os.path.exists(p):
                # ignore pure directory prefixes mentioned without a real file intent
                if os.path.isdir(p.split("/", 1)[0]) and "." not in os.path.basename(p):
                    continue
                if p not in IGNORED:
                    track(f"A {f}: references missing path -> {p}")
print(f"   scanned {len(scan_files)} files")

# ---------- B. exec-bit audit ----------
# WHY: `./p`, `p` in a make recipe, and a file bind-mount all hand the path to
# the kernel's execve, so only those need 100755. `bash p`, `sh p` and
# `source p` open the file for reading. Asserting 100755 for every `.sh`
# extension flagged 16 correctly-moded scripts, so the demand is derived from
# the call sites instead.
DIRECT_EXEC_RE = re.compile(r'(?<![\w./-])\./([A-Za-z0-9_./-]+)')
BIND_MOUNT_RE = re.compile(r'- \./([^\s:]+):/[^\s:]+')
DATA_SUFFIXES = (".sql", ".py", ".gitkeep")


def collect(files: list[str], pattern: re.Pattern[str]) -> set[str]:
    found: set[str] = set()
    for f in files:
        text: str = open(f, errors="replace").read()
        found |= {m.rstrip(".,;'\"") for m in pattern.findall(text)}
    return found


def direct_exec_paths(files: list[str]) -> set[str]:
    return collect(files, DIRECT_EXEC_RE)


def bind_mounted_paths(files: list[str]) -> set[str]:
    # WHY: a directory mount publishes its contents for sourcing, not for
    # execution, so only mounts whose source is a file are demanded.
    return {src for src in collect(files, BIND_MOUNT_RE) if os.path.isfile(src)}


def exec_bit_requirements() -> set[str]:
    compose: list[str] = sorted(p.name for p in Path(".").glob("docker-compose*.yml"))
    sources: list[str] = [f for f in scan_files + compose if os.path.isfile(f)]
    return direct_exec_paths(sources) | bind_mounted_paths(sources)


print("== B. exec-bit audit ==")
needs_x = exec_bit_requirements()
idx = subprocess.run(["git","ls-files","-s","scripts/"],capture_output=True,text=True).stdout
for line in idx.splitlines():
    mode, path = line.split()[0], line.split()[3]
    checks += 1
    if path in needs_x and mode != "100755":
        track(f"B {path}: tracked {mode}, must be 100755 (invoked/bind-mounted)")
    if path not in needs_x and mode == "100755" and path.endswith(DATA_SUFFIXES):
        track(f"B {path}: tracked 100755 but is data (.sql/.py) — review")
# root entrypoint
mode_cms = subprocess.run(["git","ls-files","-s","cms"],capture_output=True,text=True).stdout.split()[0]
checks += 1
if mode_cms != "100755": track(f"B cms: tracked {mode_cms}, must be 100755")

# ---------- C. bind-mount audit ----------
print("== C. bind-mount audit ==")
for m in COMPOSE_MOUNT_RE.finditer(compose):
    src, dst = m.group(1), m.group(2)
    checks += 1
    if not os.path.exists(src):
        if src not in IGNORED:
            track(f"C compose mount source missing -> ./{src}")
    elif os.path.isfile(src) and "/usr/local/bin/" in dst and not os.access(src, os.X_OK):
        track(f"C {src} mounted to bin path {dst} but not executable on host/index")

# ---------- D. compose profile-graph audit ----------
print("== D. compose profile-graph audit ==")
svc_re = re.compile(r"\n  ([a-z0-9-]+):\n((?:    .*\n|\n)*?)(?=\n  [a-z0-9-]+:\n|\Z)")
services = {}
for name, body in svc_re.findall(compose):
    prof = re.search(r"profiles:\n((?:\s+-\s+\S+\n)+)", body)
    deps = re.search(r"depends_on:\n((?:\s+[a-z0-9_-]+[:\s]*\n)+)", body)
    plist = set(re.findall(r"-\s+(\S+)", prof.group(1))) if prof else {"default"}
    dlist = set(re.findall(r"^\s*([a-z0-9_-]+):", deps.group(1), re.M)) if deps else set()
    services[name] = (plist, dlist)

INVOCATION_SOURCES = []
for f in scan_files:
    for i, line in enumerate(open(f, errors="replace"), 1):
        for m in re.finditer(r"--profile (\S+)", line):
            INVOCATION_SOURCES.append((f, i, m.group(1)))

# WHY the guard: this section is the only one that shells out to docker, and calling it
# unguarded made the whole audit die with a FileNotFoundError traceback on any host
# without a daemon — a workstation or CI runner. The remaining sections check stale
# paths, exec bits, bind-mount perms and CLI drift, none of which need docker, so a
# missing docker should cost this one section and nothing else. It is reported as a
# skipped check rather than a pass, because "not checked" and "checked and clean" are
# different answers and only one of them is true here.
DOCKER_AVAILABLE = shutil.which("docker") is not None

def real_validate(profiles: list[str]) -> tuple[bool, str]:
    cmd = ["docker","compose","-f","docker-compose.yml"]
    for p in profiles: cmd += ["--profile", p]
    cmd += ["config","--quiet"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stderr.strip().splitlines() or [""])[-1]

seen = {}
for f, ln, prof in INVOCATION_SOURCES:
    src = open(f, errors="replace").readlines()[ln-1]
    full = tuple(sorted(set(re.findall(r"--profile (\S+)", src))))
    if not full or any(p.startswith("$") for p in full): continue
    seen.setdefault((f, full), ln)
for (f, full), ln in sorted(seen.items()):
    checks += 1
    if not DOCKER_AVAILABLE:
        skipped += 1
        continue
    ok, why = real_validate(list(full))
    if not ok:
        track(f"D {f}:{ln}: compose profile set {list(full)} INVALID: {why}")

# ---------- F. config-surface audit ----------
print("== F. config-surface audit ==")
# WHY this is a whole section rather than one check: a duplicate key is a hard error in
# TOML, so a config.toml carrying two lines for one name does not parse at all — and the
# failure lands on whichever service reloads first, far from the edit that caused it. The
# registry side of the same mistake is quieter: two rows for one key both look valid, so
# config sync emits the key twice and the last row silently wins.
CONFIG_EXAMPLE = Path("config.toml.example")
if CONFIG_EXAMPLE.exists():
    seen_in_section = {}
    section = None
    for lineno, raw in enumerate(open(CONFIG_EXAMPLE, encoding="utf-8"), 1):
        line = raw.rstrip("\n")
        if line.startswith("[") and line.endswith("]"):
            section = line.strip()
            continue
        # An assignment at the top level of a section, not a continuation or a comment.
        assign = re.match(r"^([A-Za-z0-9_]+)\s*=", line)
        if not assign:
            continue
        name = assign.group(1)
        where = f"{section or 'top'}|{name}"
        if where in seen_in_section:
            track(f"F {CONFIG_EXAMPLE}:{lineno}: key {name} is already set at "
                  f"{CONFIG_EXAMPLE}:{seen_in_section[where]} in the same section")
            checks += 1
        else:
            seen_in_section[where] = lineno

REGISTRY_FILE = Path("scripts/__update_engine.sh")
seen_registry_rows = {}
if REGISTRY_FILE.exists():
    for lineno, raw in enumerate(open(REGISTRY_FILE, encoding="utf-8"), 1):
        for name in re.findall(r'\|\[[a-z_]+\]\|([A-Z0-9_]+)\|', raw):
            if name in seen_registry_rows:
                track(f"F {REGISTRY_FILE}:{lineno}: key {name} is already registered at "
                      f"{REGISTRY_FILE}:{seen_registry_rows[name]}")
                checks += 1
            else:
                seen_registry_rows[name] = lineno

# WHY a registered key must appear in config.toml.example: the example is the only place
# an operator learns a key exists. A registered key with no line in the example is one
# that can only be set from the TUI, while config sync is the documented path.
if CONFIG_EXAMPLE.exists() and REGISTRY_FILE.exists():
    documented = set(re.findall(r"^([A-Za-z0-9_]+)\s*=",
                                CONFIG_EXAMPLE.read_text(encoding="utf-8"), re.M))
    for name, _ in sorted(seen_registry_rows.items()):
        checks += 1
        if name not in documented:
            track(f"F {REGISTRY_FILE}: key {name} is registered but has no line in "
                  f"{CONFIG_EXAMPLE}")

# ---------- G. CLI-contract audit ----------
print("== E. cli-contract audit ==")
CONTRACTS = {
    "__preflight.sh": lambda a: a == [] or (a[0] == "--stack" and len(a) >= 2),
    "__update_engine.sh": lambda a: all(x in ("--fresh","--fix","--dry-run") for x in a),
}
caller_files = scan_files
# WHY: a script path carries CLI arguments only when something is actually
# running it. In `log_die "scripts/__preflight.sh not found"` or
# `PREFLIGHT_SCRIPT="scripts/__preflight.sh"` the words after the path are
# English or a directory prefix, and reading them as arguments is what made
# the audit report a human-readable message as CLI drift. Anchoring on a
# command position (line start, `;`/`&`/`|`, a conditional keyword, or an
# interpreter prefix) still matches every real invocation, and the argument
# group is pinned to a run of flag/word tokens so that `cd`-less sibling
# references in messages are not mistaken for arguments.
COMMAND_POSITION = (
    r"(?:^|[;&|!(]|\b(?:if|then|elif|else|while|until|do)\b)[ \t]*"
    r"(?:(?:sudo|env|exec|command|nohup|timeout|nice|bash|sh|zsh|dash)"
    r"(?:[ \t]+-\S+)*[ \t]+)*"
)
PATH_PREFIX = r"(?:[\w@.+-]+/)*"
ARGS_RE = r"[ \t]+((?:--?[\w-]+[ \t]+[\w-]+|[\w-]+)*)"
for script, validator in CONTRACTS.items():
    pat = re.compile(
        COMMAND_POSITION + PATH_PREFIX + re.escape(script) + r'"?\s*' + ARGS_RE)
    for f in caller_files:
        for i, line in enumerate(open(f, errors="replace"), 1):
            if line.strip().startswith("#"):
                continue
            if script in line and ("$" not in line.split(script)[1][:2]):
                m = pat.search(line)
                if m:
                    args = m.group(1).split()
                    checks += 1
                    if not validator(args):
                        track(f"E {f}:{i}: calls {script} with args {args} — violates current CLI")

print()
if issues:
    print(f"FINDINGS ({len(issues)}):")
    for i in issues: print("  ✗", i)
else:
    print("ALL CLEAN")
print(f"\nchecks run: {checks}")
if skipped:
    print(f"checks skipped (need docker): {skipped}")
sys.exit(1 if issues else 0)
