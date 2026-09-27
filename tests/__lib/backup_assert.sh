#!/usr/bin/env bash
# tests/__lib/backup_assert.sh — how a backup suite states a verdict.
#
# WHY collected failures instead of aborting on the first one: a backup run has several
# contracts that fail together, and the useful output is the whole list. A suite therefore
# relaxes the strict mode the shared library installs for its consumers, and every check
# reports rather than exits.
#
# Sourced by tests/__lib/backup_harness.sh. Not a suite on its own.

set -u

PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }

check_eq() { # label expected actual
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected [${2}] got [${3}])"; fi
}

check_yes() { # label condition_result
  if [[ "$2" == "yes" ]]; then ok "$1"; else bad "$1"; fi
}

# expect_exit <label> <expected> — a run whose status is wrong is unreadable without its
# log, so the log rides along with the failure instead of being hunted for afterwards.
expect_exit() { # label expected
  if [[ "$LAST_EXIT" == "$2" ]]; then
    ok "$1"
  else
    bad "$1 (expected exit ${2} got ${LAST_EXIT})"
    sed 's/^/        /' "$RUN_LOG"
  fi
}

grep_yes() { # file pattern
  if grep -q -- "$2" "$1" 2>/dev/null; then printf 'yes'; else printf 'no'; fi
}

not_grep_yes() { # file pattern — the absence is the contract
  if grep -q -- "$2" "$1" 2>/dev/null; then printf 'no'; else printf 'yes'; fi
}

# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------
count_matching() { # <dir> <glob>
  local found
  found="$(find "$1" -maxdepth 1 -type f -name "$2" 2>/dev/null | wc -l)"
  printf '%d' "${found//[[:space:]]/}"
}

count_lines() { # file
  local counted
  counted="$(wc -l < "$1" 2>/dev/null || printf '0')"
  printf '%d' "${counted//[[:space:]]/}"
}

sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

file_bytes() { stat -c%s "$1" 2>/dev/null || printf '0'; }

entry_count() { jq 'length' "$1"; }

entry_field() { # <manifest> <index> <jq filter over the entry>
  jq -r ".[${2}] | ${3}" "$1"
}

# archive_image <streaming log> — the image of the last helper invocation, read the way the
# invocation spells it: the word before `tar` in `docker run ... <image> tar czf -`.
archive_image() {
  tail -1 "$1" |
    awk '{ for (position = 1; position <= NF; position++) if ($position == "tar") { print $(position - 1); exit } }'
}

# The fields __backup_drill.sh pulls from the newest entry, read the way that script reads
# them, so a manifest a suite produced is proven usable by the reader that exists in this
# repository rather than only by the writer's own tooling. The path arrives as an argument
# rather than interpolated, which is the only difference from the original.
drill_reader() { # <manifest> -> ts TAB db_bytes TAB vol_bytes TAB pg_version
  python3 -c '
import json, sys
with open(sys.argv[1]) as handle:
    entries = json.load(handle)
newest = entries[-1] if isinstance(entries, list) and entries else None
if newest is None:
    print("unknown\t0\t0\tunknown")
else:
    print("\t".join([newest["ts"], str(newest["sizes"]["db_bytes"]),
                     str(newest["sizes"]["vol_bytes"]), newest["pg_version"]]))
' "$1"
}
