#!/usr/bin/env bash
# 002.4 — the guards are load-bearing.
#
# WHY: a guard whose removal changes no test result is a comment. This deletes each guard in turn, runs
# the test that claims it, and fails unless that test goes red. Every mutated file is restored and its
# sha256 compared, so a crashed run cannot leave the tree changed.
set -uo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PANEL="$REPO_ROOT/admin-panel"
BACKUPS=$(mktemp -d)
FAILURES=0
CASES=0

for tool in bunx python3 git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP: $tool is required" >&2; exit 0; }
done
[ -d "$PANEL/node_modules" ] || { echo "SKIP: admin-panel/node_modules is not installed" >&2; exit 0; }

restore_all() {
  local backup relative
  find "$BACKUPS" -type f 2>/dev/null | while IFS= read -r backup; do
    relative=${backup#"$BACKUPS"/}
    cp "$backup" "$REPO_ROOT/$relative"
  done
}
trap restore_all EXIT

# mutate <kind> <file>: rewrites one guard out of the shipped source.
mutate() {
  python3 - "$1" "$2" <<'PY'
import sys

kind, path = sys.argv[1], sys.argv[2]
source = open(path).read()

if kind == 'no-nginx-test':
    block = """  try {
    await runtime.front.testStagedConfig(runtime.stagingDir);
  } catch (error) {
    await fs.rm(runtime.stagingDir, { recursive: true, force: true });
    return refused('nginx-test', error);
  }
"""
    if block not in source:
        raise SystemExit('the staged nginx -t block is not where this test expects it')
    mutated = source.replace(block, '')
elif kind == 'always-write':
    guard = 'compareDir: runtime.liveDir'
    if guard not in source:
        raise SystemExit('the live-directory comparison is not where this test expects it')
    mutated = source.replace(guard, 'compareDir: runtime.stagingDir')
elif kind == 'empty-on-read-failure':
    guard = '  const [payload, frontVhosts] = await Promise.all([deps.readPayload(), deps.readFrontVhosts()]);'
    if guard not in source:
        raise SystemExit('the registry read is not where this test expects it')
    fallback = 'deps.readPayload().catch(() => ({ services: [], wirings: [], exposures: [] }))'
    mutated = source.replace(guard, f'  const [payload, frontVhosts] = await Promise.all([{fallback}, deps.readFrontVhosts()]);')
else:
    raise SystemExit(f'unknown mutation: {kind}')

open(path, 'w').write(mutated)
PY
}

# prove_guard <label> <file> <vitest> <kind> <expected red test name>
prove_guard() {
  local label=$1 file=$2 spec=$3 kind=$4 red_test=$5
  local relative=${file#"$REPO_ROOT"/}
  local before after output

  if ! git -C "$REPO_ROOT" diff --quiet -- "$relative"; then
    echo "SKIP: $relative is modified; refusing to mutate a file under edit" >&2
    return
  fi

  before=$(sha256sum "$file" | cut -d' ' -f1)
  mkdir -p "$BACKUPS/$(dirname "$relative")"
  cp "$file" "$BACKUPS/$relative"
  CASES=$((CASES + 1))

  if ! mutate "$kind" "$file"; then
    echo "FAIL: $label — the guard could not be located, so it cannot be falsified"
    FAILURES=$((FAILURES + 1))
    restore_all
    return
  fi

  output=$(cd "$PANEL" && bunx vitest run "$spec" 2>&1)
  if printf '%s\n' "$output" | grep -qF "× $red_test" || printf '%s\n' "$output" | grep -qF "$red_test"; then
    echo "PASS: $label — removing it turns '$red_test' red"
  else
    echo "FAIL: $label — tests stayed green without the guard"
    FAILURES=$((FAILURES + 1))
  fi

  restore_all
  after=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$before" != "$after" ]; then
    echo "FAIL: $label — $relative was not restored byte-for-byte"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ "$(cd "$PANEL" && bunx vitest run "$spec" 2>&1 | grep -c ' failed')" -gt 0 ]; then
    echo "FAIL: $label — $relative is not green again after the restore"
    FAILURES=$((FAILURES + 1))
  fi
}

prove_guard "the front's nginx -t on staged bytes" \
  "$PANEL/src/lib/exposure-apply.ts" tests/exposure-apply.test.ts \
  no-nginx-test "leaves the previous include byte-identical and reloads nothing when nginx rejects the staged config"

prove_guard "the changed-bytes comparison" \
  "$PANEL/src/lib/exposure-apply.ts" tests/exposure-apply.test.ts \
  always-write "reloads nothing when the save changed no byte"

prove_guard "the read-failure refusal" \
  "$PANEL/src/lib/reconciler.ts" tests/reconciler.test.ts \
  empty-on-read-failure "writes nothing when the database cannot be read"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "FAILED: $FAILURES of $CASES guards could not be shown to fail"
  exit 1
fi
echo "OK: $CASES guards, each shown to fail when removed"
