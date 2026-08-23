#!/usr/bin/env python3
"""Mechanical regression audit for cms-docker: catches the failure classes
that produced P1-P5 (stale paths, exec-bit loss, CLI drift, profile-graph
gaps, bind-mount perms)."""
import os, re, subprocess, sys

os.chdir("/mnt/Datas-Disk" if False else "/mnt/D-Datas-Disk/Champ/Coding/Github/Contest Management System/cms-docker")
issues, checks = [], 0

def track(msg):
    issues.append(msg)

# ---------- sources to scan for path references ----------
SCAN_FILES = ["cms", "Makefile", "README.md"] \
    + [f"scripts/{f}" for f in os.listdir("scripts") if f.endswith(".sh")] \
    + ["docker-compose.yml"]
scan_files = [f for f in SCAN_FILES if os.path.isfile(f)]

PATH_RE = re.compile(r'(?:scripts|config|examples|docker|backups)/[A-Za-z0-9_./-]+')
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
                track(f"A {f}: references missing path -> {p}")
print(f"   scanned {len(scan_files)} files")

# ---------- B. exec-bit audit ----------
print("== B. exec-bit audit ==")
idx = subprocess.run(["git","ls-files","-s","scripts/"],capture_output=True,text=True).stdout
for line in idx.splitlines():
    mode, path = line.split()[0], line.split()[3]
    checks += 1
    needs_x = path.endswith(".sh") or re.match(r"scripts/__(cms|worker)", path)
    if needs_x and mode != "100755":
        track(f"B {path}: tracked {mode}, must be 100755 (invoked/bind-mounted)")
    if not needs_x and mode == "100755":
        track(f"B {path}: tracked 100755 but is data (.sql/.py) — review")
# root entrypoint
mode_cms = subprocess.run(["git","ls-files","-s","cms"],capture_output=True,text=True).stdout.split()[0]
checks += 1
if mode_cms != "100755": track(f"B cms: tracked {mode_cms}, must be 100755")

# ---------- C. bind-mount audit ----------
print("== C. bind-mount audit ==")
comp = open("docker-compose.yml").read()
for m in re.finditer(r"- \./([^\s:]+):(/[^:\s]+)(?::ro)?\s*$", comp, re.M):
    src, dst = m.group(1), m.group(2)
    checks += 1
    if not os.path.exists(src):
        track(f"C compose mount source missing -> ./{src}")
    elif os.path.isfile(src) and "/usr/local/bin/" in dst and not os.access(src, os.X_OK):
        track(f"C {src} mounted to bin path {dst} but not executable on host/index")

# ---------- D. compose profile-graph audit ----------
print("== D. compose profile-graph audit ==")
svc_re = re.compile(r"\n  ([a-z0-9-]+):\n((?:    .*\n|\n)*?)(?=\n  [a-z0-9-]+:\n|\Z)")
services = {}
for name, body in svc_re.findall(comp):
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
    ok, why = real_validate(list(full))
    if not ok:
        track(f"D {f}:{ln}: compose profile set {list(full)} INVALID: {why}")

# ---------- E. CLI-contract audit ----------
print("== E. cli-contract audit ==")
CONTRACTS = {
    "__preflight.sh": lambda a: a == [] or (a[0] == "--stack" and len(a) >= 2),
    "__update_engine.sh": lambda a: all(x in ("--fresh","--fix","--dry-run") for x in a),
}
caller_files = scan_files
for script, validator in CONTRACTS.items():
    pat = re.compile(re.escape(script) + r'"?\s+((?:--?[\w-]+\s+[\w-]+|[\w-]+)*)', )
    for f in caller_files:
        for i, line in enumerate(open(f, errors="replace"), 1):
            stripped = line.strip()
            if stripped.startswith("#") or re.search(r"\b(echo|die|warn|printf|Usage|usage)\b", line):
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
sys.exit(1 if issues else 0)
