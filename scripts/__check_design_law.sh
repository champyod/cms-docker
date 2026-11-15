#!/usr/bin/env bash
# Design-law ratchet (epic 016). Usage: none (check) · --update · --report
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

SRC="${REPO_ROOT}/admin-panel/src"
BASELINE="${SCRIPT_DIR}/design-law-baseline.txt"
MODE="${1:-check}"

[ -d "$SRC" ] || log_die "missing $SRC" 1

tmp_now=$(mktemp)
tmp_prev=$(mktemp)
trap 'rm -f "$tmp_now" "$tmp_prev"' EXIT

# R1 spacing ladder · R2 type floor · R3 one spacing mechanism.
scan() { grep -rEo --include='*.ts' --include='*.tsx' "$1" "$SRC" 2>/dev/null || true; }

# The guard matters: without it "line-clamp-2" contains "p-2".
scan '(^|[^A-Za-z0-9_-])(-)?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-[0-9]+(\.[0-9]+)?' \
| awk -F: '
  BEGIN {
    split("0:0 0.5:2 1:4 1.5:6 2:8 2.5:10 3:12 3.5:14 4:16 5:20 6:24 7:28 8:32 9:36 10:40 11:44 12:48 14:56 16:64 20:80 24:96", pairs, " ")
    for (i in pairs) { split(pairs[i], kv, ":"); scale[kv[1]] = kv[2] }
    split("0 2 4 8 12 16 24 32 40 48 64 80 96", a, " ")
    for (i in a) allowed[a[i]] = 1
    allowed[1] = 1                          # 'px' is a 1px hairline, which the law exempts
    scale["px"] = ""
  }
  {
    file = $1; tok = $2
    # grep matched the guarded form (preceding char included): keep only the utility itself.
    if (match(tok, /(-)?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-[0-9]+(\.[0-9]+)?/)) tok = substr(tok, RSTART, RLENGTH)
    sub(/^-/, "", tok)
    n = tok; sub(/^[a-z-]+-/, "", n)
    px = scale[n]
    c["R1\t" file]++
    if (px != "" && !(px in allowed)) bad["R1\t" file]++
  }
  END { for (k in c) if (bad[k] > 0) printf "%s\t%d\n", k, bad[k] }
' >> "$tmp_now"

# R2 - the type set is closed {11,12,13,14,16,20,24,32}; an arbitrary size is outside it by definition.
scan 'text-\[[0-9.]+(px|rem|em)\]' \
| awk -F: '{ c["R2\t"$1]++ } END { for (k in c) printf "%s\t%d\n", k, c[k] }' >> "$tmp_now"

# R3 - gap on the container is the mechanism the law names; space-x/y is the legacy one.
scan 'space-[xy]-[0-9]+(\.[0-9]+)?' \
| awk -F: '{ c["R3\t"$1]++ } END { for (k in c) printf "%s\t%d\n", k, c[k] }' >> "$tmp_now"

sed "s|${REPO_ROOT}/||" "$tmp_now" | sort > "${tmp_now}.sum"

case "$MODE" in
  --report)
    printf 'design-law counts (rule\tfile\tcount)\n'
    cat "${tmp_now}.sum"
    exit 0
    ;;
  --update)
    cp "${tmp_now}.sum" "$BASELINE"
    log_die "baseline rewritten: $(wc -l < "$BASELINE") rows" 0
    ;;
esac

[ -f "$BASELINE" ] || log_die "missing $BASELINE — run --update once, then commit it" 1
sort "$BASELINE" > "${tmp_prev}"

regressions=$(awk -F'\t' 'NR==FNR { base[$1"\t"$2]=$3; seen[$1"\t"$2]=1; next }
  { if ($3 > base[$1"\t"$2]) printf "  %s %s: %d (baseline %d)\n", $1, $2, $3, (base[$1"\t"$2]==""?0:base[$1"\t"$2]) }
' "${tmp_prev}" "${tmp_now}.sum")

if [ -n "$regressions" ]; then
  printf 'design law broken — these files gained violations:\n%s\n' "$regressions"
  printf '\nFix them, or run --update only when the total went DOWN.\n'
  exit 1
fi

total=$(awk -F'\t' '{ s+=$3 } END { print s+0 }' "${tmp_now}.sum")
printf 'design law ok: %d rows, %d sites, no file above baseline\n' "$(wc -l < "${tmp_now}.sum")" "$total"
exit 0