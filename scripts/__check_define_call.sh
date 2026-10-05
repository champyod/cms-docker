#!/usr/bin/env bash
# Checks the shell layer for drift that no compiler sees:
#
#   dead function      — a function nothing calls and no dispatch arm names
#   undefined call     — a project-named helper invoked that nothing defines
#   unguarded external — an optional binary run without a `command -v` guard
#
# WHY these need a checker: a shell script runs whatever it reaches, so a renamed
# helper is a silent command-not-found at the first call, an optional binary that is not
# installed is a runtime failure on a host the author never sat at, and a helper left
# behind after its last caller was deleted is code nothing will ever reach again.
#
# WHY only project-named helpers are checked for undefined calls: reading a shell file
# as text cannot decide whether a word in command position is a command, a variable
# assignment, or a word inside an embedded awk or Python program. Narrowing to the
# naming conventions this tree uses for its own functions keeps the check to names that
# could only have been meant as a call, which is where a real typo shows up.
#
# Read-only: reads the tree, writes only to a temp dir removed on exit.
# Exit 0 when nothing is found. Exit 1 with `file:line` for each finding.
#
# Options:
#   --list-baseline  print the accepted findings with the WHY recorded for each; exit 0
#   --baseline       re-run with an empty allowlist, so every finding this matcher can report
#                    is printed as a `baseline_entries` line to paste. This is how a new entry
#                    gets its WHY written. Exits 1 while anything is found.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

SELF_NAME="__check_define_call.sh"
SCRIPTS_DIR="${REPO_ROOT}/scripts"

# Binaries a minimal server image may not carry. Guarding these is what keeps a run from
# dying halfway through, after it has already changed something.
# WHY a fixed list and not a discovered one: coreutils are on every host that can run
# these scripts, so guarding `grep` is noise, and discovering the set from whatever
# happens to be installed on the machine running the checker would make the verdict
# depend on the box.
OPTIONAL_EXTERNALS="certbot curl dig envsubst fail2ban-client flock getent iptables jq nc netstat openssl ss systemctl tailscale timeout yq"

# The prefixes this tree gives its own functions. A call carrying one of these and
# matching nothing defined is a rename that was not finished, not a system binary.
FUNCTION_PREFIXES="_ log_ cmd_ is_ has_ require_ send_ get_ env_ json_"

# Shell words that sit in command position without being a name this checker resolves.
SHELL_WORDS="if then else elif fi case esac for while until do done in function select time coproc return break continue local export readonly declare typeset shift exit eval exec set unset trap source . read mapfile printf echo test pwd cd true false"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# Reduces a shell file to the lines a text scan may read as code: whole-line comments
# and heredoc bodies are removed.
# WHY heredoc bodies and not quoted regions: a body is unambiguously data — a usage
# block, a config template, an embedded program — while deciding where a quote ends
# means modelling command substitution, arithmetic and escaping. A body is the only
# place these files embed another language, so removing it removes the risk without a
# parser that has to be right about every corner of the grammar.
reduce_shell() {
  awk '
    # Reads the delimiter after the << at i, or "" when the redirection is a numeric
    # shift or a here-string. Only a conventional uppercase tag opens a body: matching
    # any token turns a one-line shift into a body that never ends.
    function tag_after(text, i,   rest) {
      i++
      if (substr(text, i + 1, 1) == "-") { i++ }
      while (substr(text, i + 1, 1) ~ /[ \t]/) { i++ }
      if (substr(text, i + 1, 1) == "\"" || substr(text, i + 1, 1) == "\047") { i++ }
      if (substr(text, i + 1, 1) !~ /[A-Za-z_]/) { return "" }
      rest = substr(text, i + 1)
      sub(/[^A-Za-z0-9_].*$/, "", rest)
      return rest
    }
    { line[NR] = $0 }
    END {
      heredoc = ""
      for (n = 1; n <= NR; n++) {
        if (heredoc != "") {
          probe = line[n]
          sub(/^[ \t]*/, "", probe)
          if (probe == heredoc) { heredoc = "" }
          continue
        }
        text = line[n]
        if (index(text, "<<") > 0) {
          for (i = 1; i <= length(text); i++) {
            if (substr(text, i, 2) == "<<" && substr(text, i + 2, 1) != "<") {
              last_tag = tag_after(text, i)
              break
            }
          }
        }
        if (text ~ /^[ \t]*#/) { print ""; continue }
        print text
        if (last_tag != "") { heredoc = last_tag }
        last_tag = ""
      }
    }' "$1"
}

is_shell_word() {
  case " ${SHELL_WORDS} " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

is_function_prefix() {
  local prefix
  for prefix in ${FUNCTION_PREFIXES}; do
    case "$1" in
      "$prefix"*) return 0 ;;
    esac
  done
  return 1
}

is_optional_external() {
  case " ${OPTIONAL_EXTERNALS} " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# The findings that are correct today, each with the reason it exists.
# WHY an allowlist and not a looser matcher: a check that passes because its matcher is
# permissive is no longer evidence. Naming the exact accepted finding keeps every other
# finding a failure.
# WHY these seven sit here and not in the source: each is a real gap, and closing it
# changes what the script does at runtime, which belongs to the change that owns the
# script rather than to the change that adds the checker. Removing the entry is the
# signal that the gap was closed.
# Format: <check>|<file>|<name>|<why it is accepted>.
baseline_entries() {
  cat <<'BASELINE'
dead-fn|scripts/__preflight.sh|stack_includes|No caller yet; the stack filter that will use it is not written. Deleting it now would delete the logic that filter needs.
dead-fn|scripts/__update_engine.sh|check_connection|No caller yet; the reachability probe that will use it is not written. Deleting it now would delete the logic that probe needs.
dead-fn|scripts/__update_engine.sh|ensure_worker_cgroup_setup|No caller yet; the update wizard offers this from its own flow. Deleting it now would delete the prompt.
unguarded|scripts/__backup.sh|curl|Discord webhook post; a failure is already swallowed by the trailing ||, so the run continues without the alert.
unguarded|scripts/__nginx-proxy-render.sh|envsubst|Runs as a build step inside the nginx container image, where envsubst is part of the base image rather than the host.
unguarded|scripts/__update-server.sh|curl|Health probe with -fsS and an explicit timeout; the caller reports the failure, so an absent curl surfaces as a failed check rather than a broken run.
unguarded|scripts/__worker_cgroup_setup.sh|systemctl|Reached only after the script has refused to run without root, and on a host where docker.service exists by definition.
BASELINE
}

# WHY `--baseline` empties the allowlist instead of widening a matcher: what an author needs
# before writing a WHY is every finding this tree produces today, and the tolerated ones are
# only visible once the tolerance is taken away. Reporting them together also puts a newly
# appeared finding beside the entries already there, which is what shows whether it is the
# same gap or a new one.
is_baselined() {
  [ "$show_all" -eq 0 ] || return 1
  baseline_entries | grep -qF -- "$1|$2|$3|"
}

# WHY a flag rather than a positional: the tolerated set is the part a reviewer has to
# read before trusting an exit code, and a checker nobody can ask what it excuses is a
# checker nobody audits.
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
  log_info "accepted findings, and why each one is correct:"
  if ! baseline_entries | grep -q .; then
    log_info "  (none — every finding this checker can report is a failure)"
  else
    baseline_entries | while IFS='|' read -r check file name why; do
      printf '  %-9s %-34s %-26s %s\n' "$check" "$file" "$name" "$why"
    done
  fi
  exit 0
fi
if [ "$show_all" -ne 0 ]; then
  log_info "every finding with the allowlist empty; each line below is one entry to paste into baseline_entries, and the reason field is the part a human has to write:"
fi

# The files under test, in a fixed order so two runs report in the same sequence.
script_files() {
  find "$SCRIPTS_DIR" -name '*.sh' -type f -print0 \
    | LC_ALL=C sort -z \
    | tr '\0' '\n' \
    | grep -v "/${SELF_NAME}\$"
}

findings="${tmp_dir}/findings"
: > "$findings"
candidates="${tmp_dir}/candidates"
: > "$candidates"

# Records one finding twice: the message an operator reads, and the entry an author pastes.
# WHY two files rather than one record parsed back apart: the reported message carries a
# file:line the entry does not need, and re-deriving that line out of prose is how an entry
# ends up naming the wrong file.
record_finding() {
  printf '%s\n' "$4" >> "$findings"
  printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "$candidates"
}

# Every function name the tree defines, so a call to a shared helper resolves.
defined_cache="${tmp_dir}/defined"
grep -rhoE '^[[:space:]]*[a-z_][a-zA-Z0-9_]*\(\)[[:space:]]*\{' "$SCRIPTS_DIR" --include='*.sh' 2>/dev/null \
  | sed -E 's/^[[:space:]]*//; s/\(\)[[:space:]]*\{$//' \
  | LC_ALL=C sort -u > "$defined_cache"

# The line a name is defined on, or empty when the reduction dropped the definition.
definition_line() {
  grep -nE "^[[:space:]]*${2}\(\)[[:space:]]*\{" "$1" | head -1 | cut -d: -f1 || true
}

# A function nothing calls is dead weight: its last caller was deleted, so its body can
# never run. WHY the search spans the tree and not the defining file: a helper in __lib
# is called from a sibling script. The definition itself is one hit, so a total of one
# means there is no caller.
# WHY the checker excludes its own file from that search: its baseline names every accepted
# dead function, so including it gave each one a phantom caller. An entry could then never
# be reported again, and `--baseline` could not list it — a tolerated item nothing could see.
check_dead_functions() {
  local rel="$1" plain="$2" fn hits
  while IFS= read -r fn; do
    [ -n "$fn" ] || continue
    hits=$(grep -row --include='*.sh' --exclude="${SELF_NAME}" -- "$fn" "$SCRIPTS_DIR" 2>/dev/null | wc -l)
    [ "$hits" -gt 1 ] && continue
    is_baselined "dead-fn" "$rel" "$fn" && continue
    record_finding "dead-fn" "$rel" "$fn" \
      "dead function: ${rel}:$(definition_line "$plain" "$fn") defines ${fn}() and no script in scripts/ calls it"
  done < <(grep -oE '^[[:space:]]*[a-z_][a-zA-Z0-9_]*\(\)[[:space:]]*\{' "$plain" | sed -E 's/^[[:space:]]*//; s/\(\)[[:space:]]*\{$//')
}

# A name in command position that carries one of the tree's own function prefixes and
# matches no definition is a call to something that does not exist. Both a statement
# and a command substitution are read, because a script calls helpers in both.
# WHY a closing paren disqualifies a name: in a `case` branch `log_die)` would be a
# pattern label, and in `$(cmd)` the paren ends the substitution rather than the name.
check_undefined_calls() {
  local rel="$1" plain="$2" name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    is_shell_word "$name" && continue
    is_function_prefix "$name" || continue
    grep -qx -- "$name" "$defined_cache" && continue
    is_baselined "undefined" "$rel" "$name" && continue
    record_finding "undefined" "$rel" "$name" \
      "undefined call: ${rel}:$(caller_line "$plain" "$name") calls ${name}, which no script in scripts/ defines"
  done < <(
    # WHY arithmetic initialisers are read too: `for (( _i = 1; ... ))` binds a counter
    # that a name-prefix filter would otherwise report as a call to a function.
    { grep -oE '(^[[:space:]]*|[;&|][[:space:]]*)[a-z_][a-z0-9_]*(::|[[:space:]]|$)' "$plain" || true
      grep -oE '\$\([[:space:]]*[a-z_][a-z0-9_]*(::|[[:space:];|)])' "$plain" || true
      grep -oE '\$\(\([[:space:]]*[a-z_][a-z0-9_]*[[:space:]]' "$plain" || true
    } | sed -E 's/^[^a-z_(]*[($]//; s/::.*$//; s/[[:space:];|)]+$//' | LC_ALL=C sort -u
  )
}

# The first line the reduced file invokes the name, or empty when no form matched. The
# forms searched are the separators a command can be preceded or followed by; a regex
# cannot be used because the name is a bare word that also appears inside strings and
# inside longer identifiers. A finding without a line is still a finding — dropping it
# would be worse than reporting it unlocated.
caller_line() {
  local name="$2"
  {
    grep -nF -e "${name} " -e "${name}(" -e "${name};" -e "${name})" -e "${name}|" -e "|${name} " "$1" || true
  } | head -1 | cut -d: -f1
}

# An optional binary the script runs without asking whether it exists. `command -v` is
# the guard, and it has to name the binary in the same file: a guard in a sibling script
# proves nothing about the host this one runs on.
check_unguarded_externals() {
  local file="$1" rel="$2" plain="$3" guarded name
  guarded=$( { grep -oE 'command -v [a-z0-9_.-]+' "$file" 2>/dev/null || true; } | sed 's/command -v //' | LC_ALL=C sort -u)
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    is_optional_external "$name" || continue
    printf '%s\n' "$guarded" | grep -qx -- "$name" && continue
    is_baselined "unguarded" "$rel" "$name" && continue
    record_finding "unguarded" "$rel" "$name" \
      "unguarded external: ${rel}:$(caller_line "$plain" "$name") runs ${name} with no \"command -v ${name}\" guard in this file"
  done < <(
    { grep -oE '(^[[:space:]]*|[;&|][[:space:]]*)[a-z][a-z0-9-]*([[:space:]]|$)' "$plain" || true
    } | sed -E 's/^[^a-z]*//; s/[[:space:]]+$//' | LC_ALL=C sort -u
  )
}

# An orphan-variable check is deliberately absent. Deciding whether a UPPER_SNAKE name is
# read requires knowing where every read is, and a read inside a heredoc body counts:
# __monitor.sh builds its Discord payload in one, so HOSTNAME is assigned on line 18 and
# used on line 163 with the only use between the markers this reducer removes. Every
# matcher tried either reported those as orphans or excused real ones with a wider one,
# which is the shape of a check that cannot be trusted to fail when it says OK.

while IFS= read -r file; do
  [ -n "$file" ] || continue
  rel="${file#"${REPO_ROOT}/"}"
  plain="${tmp_dir}/plain"
  reduce_shell "$file" > "$plain"
  check_dead_functions "$rel" "$plain"
  check_undefined_calls "$rel" "$plain"
  check_unguarded_externals "$file" "$rel" "$plain"
done < <(script_files)

total=$(wc -l < "$findings")
if [ "$total" -eq 0 ]; then
  accepted=$(baseline_entries | grep -c . || true)
  log_info "define/call OK: no dead functions, no undefined calls, every optional external guarded (${accepted} pre-existing finding(s) on the baseline)"
  exit 0
fi
if [ "$show_all" -ne 0 ]; then
  LC_ALL=C sort "$candidates" | while IFS='|' read -r check file name message; do
    printf '  %-9s %-34s %-26s REASON NEEDED: %s\n' "$check" "$file" "$name" "$message"
  done
  log_die "define/call: ${total} finding(s) with the allowlist empty; each line above needs a WHY in baseline_entries before it is accepted"
fi
LC_ALL=C sort "$findings" | while IFS= read -r finding; do
  log_warn "$finding"
done
log_die "define/call FAILED: ${total} finding(s); run with --list-baseline to see what is accepted and why"
