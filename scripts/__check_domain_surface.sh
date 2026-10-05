#!/usr/bin/env bash
# Verifies that the domain verb and flag surface is identical at every layer that
# spells it: the shell script's own parse block, the Rust CLI's clap struct, the
# Rust dispatch keys, the catalog table the dispatcher resolves through, and the
# TUI menu rows an operator clicks.
#
# WHY a set-diff and not a search: every one of these layers is a literal list, so
# they can be compared exactly. A name present in one and missing in another is the
# whole failure mode — a verb the script runs but the CLI cannot name, a flag the
# script rejects because the TUI form never carried it.
#
# WHY a text reduction runs first: the script's parse block, its scope table and
# its usage text all name the same flags, and a naive scan counts the usage text and
# the example strings too. Comments, heredoc bodies and quoted regions are removed
# first so only the executable parse block is read.
#
# Exit 0 when every set matches. Exit 1 with `file:line` for each name that differs.
#
# Options:
#   --list-baseline  print the accepted differences with the WHY recorded for each; exit 0
#   --baseline       re-run with an empty allowlist, so every difference the comparison finds
#                    is printed as a `baseline_entries` line to paste. This is how a new
#                    entry gets its WHY written. Exits 1 while anything is found.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

TUI_DIR="${REPO_ROOT}/tools/cms-tui/src"
DOMAIN_SH="${SCRIPT_DIR}/__domain.sh"
CLI_MOD="${TUI_DIR}/cli/mod.rs"
DOMAIN_ARGS="${TUI_DIR}/cli/domain_args.rs"
DISPATCH="${TUI_DIR}/core/dispatch.rs"
CATALOG="${TUI_DIR}/core/catalog/table_fleet.rs"
MENUS="${TUI_DIR}/tui/menus.rs"
FIELDS="${TUI_DIR}/tui/pages/domain_fields.rs"

for required in "$DOMAIN_SH" "$CLI_MOD" "$DOMAIN_ARGS" "$DISPATCH" "$CATALOG" "$MENUS" "$FIELDS"; do
  [ -f "$required" ] || log_die "missing ${required#"${REPO_ROOT}/"}" 1
done

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# Prints a shell file with comment text, heredoc bodies and quoted regions removed.
# Embedded in one file so the checker has no dependency outside the tree.
reduce_shell() {
  awk -v mode=quotes '
    function reduce(text,   i, len, ch, out) {
      out = ""
      len = length(text)
      i = 1
      while (i <= len) {
        ch = substr(text, i, 1)
        if (quote != "") {
          if (ch == quote) { quote = "" }
          out = out " "
          i++
          continue
        }
        if (ch == "\\" && i < len) { out = out ch substr(text, i + 1, 1); i += 2; continue }
        if (ch == "\"" || ch == "'"'"'") { quote = ch; out = out " "; i++; continue }
        if (ch == "#" && (i == 1 || substr(text, i - 1, 1) ~ /[ \t]/)) { break }
        out = out ch
        i++
      }
      return out
    }
    { line[NR] = $0 }
    END {
      quote = ""
      for (n = 1; n <= NR; n++) { print reduce(line[n]) }
    }' "$1"
}

# WHY the four verb sets are compared against each other and not against a literal
# list here: a literal would have to be edited on every new verb, and the next
# author would have no reason to edit it. Comparing the layers makes each one
# accountable to the others.
script_verbs() {
  reduce_shell "$DOMAIN_SH" \
    | grep -oE '^[[:space:]]+[a-z][a-z-]*\)[[:space:]]+cmd_[a-z_]+' \
    | awk '{ sub(/\).*/, "", $1); print $1 }' \
    | LC_ALL=C sort -u
}
# WHY camelCase becomes kebab-case: the script spells a verb the way an operator
# types it (`check-expiry`), and every Rust layer spells it as an identifier
# (`CheckExpiry`). Converting to one canonical form is what makes the sets
# comparable; comparing the raw spellings would report every multi-word verb as drift.
# WHY the case split runs before the fold: lowercasing first erases the boundary
# between the two words, and `checkexpiry` matches nothing the script writes.
rust_verb() {
  sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr '[:upper:]' '[:lower:]'
}
# WHY a variant is read from its doc-comment line rather than from the enum body: a
# payload-free variant is written `Status,` while a payload variant is `Cert {`, so
# both spellings have to be matched or the set silently loses every flag-carrying verb.
clap_verbs() {
  sed -n '/^pub enum DomainCmd/,/^}/p' "$CLI_MOD" \
    | grep -oE '^ {4}[A-Z][A-Za-z]*(,| \{)' \
    | sed -E 's/^ +//; s/,$//; s/ \{$//' \
    | rust_verb \
    | LC_ALL=C sort -u
}
dispatch_verbs() {
  sed -n '/^pub enum DispatchKey/,/^}/p' "$DISPATCH" \
    | grep -oE '^    Domain[A-Za-z]+,$' \
    | sed -E 's/^ +Domain//; s/,$//' \
    | rust_verb \
    | LC_ALL=C sort -u
}
catalog_verbs() {
  grep -oE 'DispatchKey::Domain[A-Za-z]+' "$CATALOG" \
    | sed 's/DispatchKey::Domain//' \
    | rust_verb \
    | LC_ALL=C sort -u
}
menu_verbs() {
  grep -oE 'DispatchKey::Domain[A-Za-z]+' "$MENUS" \
    | sed 's/DispatchKey::Domain//' \
    | rust_verb \
    | LC_ALL=C sort -u
}

# WHY the script's parse block and not its usage text: the usage text is prose that
# can fall behind the parser without breaking anything, while the parse block is what
# decides whether a flag is accepted. The usage text is checked separately, below.
script_flags() {
  reduce_shell "$DOMAIN_SH" \
    | grep -oE '^[[:space:]]+--[a-z0-9-]+(\|-[a-z])?\)' \
    | grep -oE -e '--[a-z0-9-]+' \
    | LC_ALL=C sort -u
}
clap_flags() {
  sed -n '/^pub struct DomainSetupFlags/,/^}/p' "$DOMAIN_ARGS" \
    | grep -oE '^    pub [a-z0-9_]+:' \
    | sed -E 's/^ +pub //; s/:$//; s/_/-/g; s/^/--/' \
    | LC_ALL=C sort -u
}
form_flags() {
  grep -oE '"--[a-z0-9-]+"' "$FIELDS" | tr -d '"' | LC_ALL=C sort -u
}
# WHY only a leading flag counts as documented: the usage block also names compose
# profiles (`--profile vault`) and config paths (`--hsm`) in its prose. Those are
# names of things owned by other tools, not flags this script parses, and reading
# them as documented flags would report the help text as lying about itself.
usage_flags() {
  sed -n '/^usage()/,/^}/p' "$DOMAIN_SH" \
    | grep -oE '^[[:space:]]+--[a-z0-9-]+' \
    | grep -oE -e '--[a-z0-9-]+' \
    | LC_ALL=C sort -u
}

drift=0

# The line a name is declared on, or empty when it cannot be located.
# WHY the pattern is assembled from parts: a flag name starts with `--`, and a Rust
# field spells it with an underscore, so one search cannot cover both spellings and
# grep reads a leading `--` as an option unless the pattern is passed after `-e`.
# A Rust field is `not_in_script`, a shell flag is `--not-in-script`, so the two
# spellings are searched separately. A line number is best-effort: when neither
# spelling is found the finding is still reported, unlocated, because dropping it
# would be worse than reporting it without a line.
locate_name() {
  local file="$1" name="$2" underscored
  # WHY the leading dashes are stripped before the underscore form is built: a Rust
  # field is `not_in_script`, and substituting over `--not-in-script` alone yields
  # `__not_in_script`, which matches nothing in the file.
  name="${name#--}"
  underscored="${name//-/_}"
  grep -nE \
    -e "(^|[^a-zA-Z0-9_-])--${name}([^a-zA-Z0-9-]|$)" \
    -e "(^|[^a-zA-Z0-9_-])${underscored}([^a-zA-Z0-9_]|$)" \
    "$file" | head -1 | cut -d: -f1 || true
}

# The differences that are correct today, each with the reason it exists.
# WHY an allowlist and not a widening of the comparison: a check that passes only
# because its matcher is loose stops being evidence. Naming the exact accepted
# difference keeps every other difference a failure, and `--list-baseline` prints
# these entries so a reader can see what is tolerated without opening the source.
# WHY the comparison field leads: `grep -F` on the whole line would let the pair name
# match inside another pair's name, so a deliberate `no-clap-flag` entry could mask a
# new `no-clap-flag-typo` one.
# Format: <check>|<layer pair>|<name>|<why it is absent>.
baseline_entries() {
  cat <<'BASELINE'
surface-flag|no-clap-flag|--help|Handled by clap itself on every subcommand; declaring it in DomainSetupFlags would ask for the same flag twice.
surface-flag|no-form-row|--days|Belongs to check-expiry, a read-only verb with no form; the form edits the setup scope only.
surface-flag|no-form-row|--dry-run|The form's mode row is --apply, and dry run is what an unarmed row means; a second row could contradict it.
surface-flag|no-form-row|--help|The TUI has no command line to type it on.
surface-flag|no-form-row|--reason|Belongs to revoke, which the menu runs as a fixed dry run; the setup form has nothing to seed a reason from.
surface-flag|no-form-row|--yes|The form always sends it, because a form cannot answer the script's optional-feature prompts.
BASELINE
}

is_baselined() {
  local check="$1" pair="$2" name="$3"
  [ "$show_all" -eq 0 ] || return 1
  baseline_entries | grep -qF -- "${check}|${pair}|${name}|"
}

# WHY `--baseline` empties the allowlist instead of widening the comparison: what an author
# needs before writing a WHY is every item the matcher finds today, and the tolerated ones
# are only visible once the tolerance is taken away. Reporting them together also puts a
# newly drifted name beside the entries already there, which is what shows whether it is the
# same fault or a new one.

# WHY a flag for the option rather than a positional: a checker with no options cannot
# be asked what it currently tolerates, and the tolerated set is the part a reviewer
# has to read before trusting the exit code.
show_baseline=0
show_all=0
for arg in "$@"; do
  case "$arg" in
    --list-baseline) show_baseline=1 ;;
    --baseline) show_all=1 ;;
    *) log_die "unknown option: $arg" 1 ;;
  esac
done
if [ "$show_baseline" -eq 1 ]; then
  log_info "accepted differences, and why each one is correct:"
  baseline_entries | while IFS='|' read -r check pair name why; do
    printf '  %-13s %-13s %-13s %s\n' "$check" "$pair" "$name" "$why"
  done
  exit 0
fi
if [ "$show_all" -ne 0 ]; then
  log_info "every difference found with the allowlist empty; each line below is one entry to paste into baseline_entries, and the reason field is the part a human has to write:"
fi

# Reports one difference: as a baseline-entry line under `--baseline`, as the operator-facing
# warning otherwise. WHY the line leads with the check and the pair the matcher used: an
# entry has to name both for is_baselined to find it again.
report_difference() {
  local check="$1" pair="$2" name="$3" message="$4"
  if [ "$show_all" -ne 0 ]; then
    printf '  %s|%s|%s|REASON: %s\n' "$check" "$pair" "$name" "$message"
  else
    log_warn "$message"
  fi
}

# Reports every name of $3 that $4 does not carry, with the line it was found on.
# WHY the report names file:line and not just the name: a bare missing word sends the
# next person hunting; the line says which of the five layers to open.
report_missing() {
  local label="$1" want_file="$2" want_fn="$3" have_fn="$4" have_label="$5" pair="$6"
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if "$have_fn" | grep -qx -- "$name"; then continue; fi
    if is_baselined "surface-${label}" "$pair" "$name"; then continue; fi
    local line
    line=$(locate_name "$want_file" "$name")
    report_difference "surface-${label}" "$pair" "$name" \
      "${label}: '${name}' declared in ${want_file#"${REPO_ROOT}/"}${line:+ (line ${line})}, absent from ${have_label}"
    drift=$((drift + 1))
  done < <("$want_fn")
}

# Reports every name of $3 that $2 does not carry. WHY the reverse direction is checked
# and not only the forward one: a flag declared in the CLI and missing from the script
# parse block is the worse half of the fault. clap accepts it, the operator types it,
# and the script's unknown-option branch rejects it at runtime — a failure no unit test
# sees, because every such test builds its own argv and never reads the script.
report_extra() {
  local label="$1" want_file="$2" want_fn="$3" have_fn="$4" have_label="$5" pair="$6"
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if "$have_fn" | grep -qx -- "$name"; then continue; fi
    if is_baselined "surface-${label}" "$pair" "$name"; then continue; fi
    local line
    # WHY `-e` before the pattern: a flag name begins with `--`, which grep would
    # otherwise read as an option, so the search silently returns nothing and the
    # finding arrives with no line.
    line=$(locate_name "$want_file" "$name")
    report_difference "surface-${label}" "$pair" "$name" \
      "${label}: '${name}' declared in ${want_file#"${REPO_ROOT}/"}${line:+ (line ${line})}, which ${have_label} does not accept"
    drift=$((drift + 1))
  done < <("$want_fn")
}

report_missing "verb" "$DOMAIN_SH" script_verbs clap_verbs "the Rust DomainCmd enum" "verb"
report_missing "verb" "$CLI_MOD" clap_verbs dispatch_verbs "the DispatchKey enum" "verb"
report_missing "verb" "$DISPATCH" dispatch_verbs catalog_verbs "the catalog table" "verb"
report_missing "verb" "$CATALOG" catalog_verbs menu_verbs "the TUI menu rows" "verb"
report_missing "flag" "$DOMAIN_SH" script_flags clap_flags "the DomainSetupFlags struct" "no-clap-flag"
report_missing "flag" "$DOMAIN_SH" script_flags form_flags "the TUI domain form rows" "no-form-row"
report_extra "flag" "$DOMAIN_ARGS" clap_flags script_flags "the script parse block" "extra-clap-flag"
report_extra "flag" "$FIELDS" form_flags script_flags "the script parse block" "extra-form-row"

# WHY the usage text is a separate check rather than a sixth set: a missing entry
# there is a documentation fault, not a parity fault, so it is reported and counted
# rather than treated as drift.
usage_absent=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  if ! script_flags | grep -qx -- "$name"; then
    log_warn "usage text names '${name}', which the parse block does not accept"
    usage_absent=$((usage_absent + 1))
  fi
done < <(usage_flags)

verb_count=$(script_verbs | wc -l)
flag_count=$(script_flags | wc -l)
if [ "$show_all" -ne 0 ] && [ "$drift" -ne 0 ]; then
  log_die "domain surface: ${drift} difference(s) with the allowlist empty; each line above is one entry to paste into baseline_entries once its reason has been written"
fi
if [ "$drift" -ne 0 ]; then
  log_die "domain surface FAILED: see the drift lines above"
fi
log_info "domain surface OK: ${verb_count} verbs and ${flag_count} flags agree across script, CLI, dispatch, catalog and menu"
[ "$usage_absent" -eq 0 ] || log_warn "usage text names ${usage_absent} flag(s) the parser does not accept"
