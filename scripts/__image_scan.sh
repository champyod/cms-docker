#!/usr/bin/env bash
# scripts/__image_scan.sh — scan the images this repo PINS, nightly, and say so where a human looks.
#
# WHY this exists: every third-party image in docker-compose*.yml is digest-pinned
# (docs/decisions/image-digest-pinning.md) and CI only scans the one image it builds
# (`container-scan` in ci.yml scans cms-admin-panel:scan). So a CVE that lands in postgres:15 or
# nginx:alpine after the pin was chosen has no signal at all: no job reads those digests, and a
# fixable CRITICAL sits in a running database until someone happens to read a registry page.
# .github/workflows/image-scan.yml runs this nightly and upserts one issue from the result.
#
# The inventory is DISCOVERED, never listed here: a hardcoded image list goes stale the day
# someone adds a service, and a stale list is worse than none because it reads as coverage.
# The compose files are the source of truth (they are what a deploy runs), so this parses their
# `image:` lines, unwraps `${VAR:-default}`, and skips our own `ghcr.io/champyod/*` refs — those
# are built and pushed by this repo's CI, selected at deploy time by ${IMG_TAG}, and scanned by
# ci.yml's `container-scan` on the push that produced them.
#
# Two facts this script refuses to fake:
#   * ZERO refs is an error, not a pass. An empty glob (a rename, a wrong working directory) would
#     otherwise turn "found nothing to scan" into a green run.
#   * A registry answer it could not obtain is `unknown`, never `up to date`. A drift check that
#     reads as ok because it was rate-limited (429) or refused (401, a repo we do not own) is the
#     exact failure mode it exists to prevent.
#
# Usage:
#   __image_scan.sh refs  [--refs <file>] [--out <dir>]                     # print the pinned refs
#   __image_scan.sh scan  [--refs <file>] [--out <dir>]                     # trivy each ref; exit 1 on fixable
#   __image_scan.sh drift [--refs <file>] [--out <dir>]                     # registry digest now vs the pin
#   __image_scan.sh report [--out <dir>] [--run-url <url>]                  # markdown for summary + issue
#
# Exit codes for `scan`, and what the workflow does with each:
#   0  every ref scanned, nothing fixable            -> issue closed, "clean as of <date>"
#   1  every ref scanned, fixable CRITICAL/HIGH       -> issue upserted open, job red
#   2  a scan did not complete (pull failure, error)  -> issue says INCOMPLETE, job red
# Exit 1 is a verdict; exit 2 is ignorance. They must not look alike: the issue body and the
# hidden state marker carry the difference, so yesterday's table can never read as today's.
set -uo pipefail
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# The trivy the hand-run in docs/SECURITY-FEED.md used, pinned by digest like every other image
# this repo pulls. Overridable only so a dev box can run the same code against a local copy.
TRIVY_IMAGE="${IMAGE_SCAN_TRIVY_IMAGE:-ghcr.io/aquasecurity/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c}"
# The suppressions are the waiver table, rendered by scripts/__security_waivers.sh — one ignore
# file for the repo, generated and gitignored, exactly as ci.yml's container-scan uses it. The
# path is overridable so the suite can assert the refusal below without touching the tree.
WAIVER_FILE="${IMAGE_SCAN_WAIVER_FILE:-${REPO_ROOT}/.trivyignore}"
SEVERITY="CRITICAL,HIGH"

die() { printf 'image-scan: %s\n' "$1" >&2; exit "${2:-2}"; }
note() { printf 'image-scan: %s\n' "$1" >&2; }

mode="${1:-}"
case "$mode" in
  refs|scan|drift|report) ;;
  *) die "usage: $0 refs|scan|drift|report [--refs <file>] [--out <dir>]" 2 ;;
esac
shift

REFS_FILE=""
OUT_DIR="${REPO_ROOT}/.image-scan"
RUN_URL=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --refs) REFS_FILE="${2:-}"; shift 2 ;;
    --refs=*) REFS_FILE="${1#*=}"; shift ;;
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --out=*) OUT_DIR="${1#*=}"; shift ;;
    --run-url) RUN_URL="${2:-}"; shift 2 ;;
    --run-url=*) RUN_URL="${1#*=}"; shift ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done

# ── inventory ────────────────────────────────────────────────────────────────────────────────
# Same glob set and same skip rules as tests/test_image_pins.sh, because a scanner that walks a
# different tree than the gate judges would report on files the pin policy never saw. Skipped:
# `*generated*` (written by `./cms config sync` at run time, not repository content) and any file
# git ignores (docker-compose.expose.yml is an operator artifact generated on the host).
compose_files() {
  local f
  for f in "${REPO_ROOT}"/docker-compose*.yml "${REPO_ROOT}"/docker/docker-compose*.yml; do
    [ -f "$f" ] || continue
    case "$f" in *generated*) continue ;; esac
    if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 &&
       git -C "$REPO_ROOT" check-ignore -q -- "$f" 2>/dev/null; then
      continue
    fi
    printf '%s\n' "$f"
  done
}

# image_value <raw yaml value> -> the reference a deploy actually runs, with the `${VAR:-default}`
# wrapper unwrapped: the default IS the image when the variable is unset, which is the case on a
# plain checkout. Mirrors tests/test_image_pins.sh so both read one line the same way.
image_value() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  v="${v%%[[:space:]]#*}"
  v="${v%\"}"; v="${v#\"}"
  v="${v%\'}"; v="${v#\'}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ "$v" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.+)\}$ ]]; then
    v="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$v"
}

# discover_refs -> one distinct third-party reference per line, first-seen order.
#
# Identity is normalised the way tests/test_image_pins.sh normalises it: `docker.io/library/postgres`
# and `postgres` are the same image, so they are scanned once, not twice. The digest is part of the
# key, so if two spellings ever carried different pins both would be scanned — the scan must not
# hide a disagreement the pin gate already reports.
ref_key() {
  local r="$1" digest="" name
  case "$r" in
    *@sha256:*) digest="${r##*@}"; name="${r%%@*}" ;;
    *) name="$r" ;;
  esac
  name="${name#docker.io/library/}"
  name="${name#docker.io/}"
  name="${name#index.docker.io/}"
  name="${name#library/}"
  printf '%s%s' "$name" "${digest:+@$digest}"
}

discover_refs() {
  local f raw ref key
  declare -A seen=()
  while IFS= read -r f; do
    while IFS= read -r raw; do
      ref="$(image_value "${raw#*image:}")"
      [ -n "$ref" ] || continue
      # Our own images: built by this repo's CI, selected by ${IMG_TAG}, scanned by ci.yml.
      case "$ref" in ghcr.io/champyod/*) continue ;; esac
      key="$(ref_key "$ref")"
      [ -n "${seen[$key]:-}" ] && continue
      seen["$key"]=1
      printf '%s\n' "$ref"
    done < <(grep -E '^[[:space:]]*image:[[:space:]]*' "$f")
  done < <(compose_files)
}

load_refs() {
  if [ -n "$REFS_FILE" ]; then
    [ -f "$REFS_FILE" ] || die "no refs file at ${REFS_FILE} — the discovery step wrote nothing" 2
    grep -v -E '^[[:space:]]*$' "$REFS_FILE"
  else
    discover_refs
  fi
}

case "$mode" in
  refs)
    mapfile -t refs < <(load_refs)
    if [ "${#refs[@]}" -eq 0 ]; then
      die "no third-party image references found in docker-compose*.yml — the scan, not the tree, is broken" 1
    fi
    printf '%s\n' "${refs[@]}"
    note "${#refs[@]} third-party refs discovered"
    ;;

  scan)
    mapfile -t refs < <(load_refs)
    if [ "${#refs[@]}" -eq 0 ]; then
      die "refusing to report a scan of zero refs — an empty inventory is an error, not a pass" 1
    fi
    # Waivers are rendered, never read from a tracked file: a scan that silently dropped them
    # would turn a live waiver into a failure, and one that read an old file would hide a lapse.
    if [ ! -f "$WAIVER_FILE" ]; then
      die "missing ${WAIVER_FILE#"$REPO_ROOT"/} — render the waivers first: bash scripts/__security_waivers.sh render --trivy .trivyignore" 2
    fi
    if ! command -v jq >/dev/null 2>&1; then
      die "jq is required to read trivy's report" 2
    fi

    mkdir -p "$OUT_DIR/cache" "$OUT_DIR/json"
    : > "$OUT_DIR/fixable.tsv"    # ref <TAB> fixable CRITICAL/HIGH (waivers applied)
    : > "$OUT_DIR/total.tsv"      # ref <TAB> all CRITICAL/HIGH <TAB> top-3 packages
    rm -f "$OUT_DIR/state" "$OUT_DIR/fixable-total"

    # The waiver file is mounted where it lives, read-only, and passed by that path: the ids are
    # whatever `__security_waivers.sh render` just wrote, not a copy this script could drift from.
    waiver_dir="$(cd -- "$(dirname -- "$WAIVER_FILE")" && pwd)"
    waiver_name="$(basename -- "$WAIVER_FILE")"

    # trivy_run <output.json> <exit-code> <ref> [extra flags…]
    # The cache and the report directory are the only writable mounts; the image itself is pulled
    # by digest, so the scanner that judges is the scanner the docs pinned.
    trivy_run() {
      local out_name="$1" exit_code="$2" ref="$3"
      shift 3
      docker run --rm \
        -v "$OUT_DIR/cache:/root/.cache/trivy" \
        -v "$OUT_DIR/json:/out" \
        -v "${waiver_dir}:/waivers:ro" \
        "$TRIVY_IMAGE" image \
        --quiet \
        --severity "$SEVERITY" \
        --vuln-type os,library \
        "$@" \
        --format json --output "/out/${out_name}" \
        --exit-code "$exit_code" "$ref"
    }

    incomplete=0
    fixable_total=0
    scanned=0

    # The two reports per image are deliberate: the policy run answers "must this fail today"
    # (fixable only, waivers applied — the same flags ci.yml passes the action), and the
    # visibility run answers "how big is the tail" (everything at CRITICAL/HIGH, unfiltered), so
    # the unfixed 62 in postgres stay countable without reddening a run every night.
    for ref in "${refs[@]}"; do
      slug="$(printf '%s' "$ref" | tr '/:@' '___')"
      fix_json="$OUT_DIR/json/${slug}.fixable.json"
      all_json="$OUT_DIR/json/${slug}.all.json"
      note "scanning ${ref}"

      trivy_run "${slug}.fixable.json" 1 "$ref" \
        --ignore-unfixed --ignorefile "/waivers/${waiver_name}"
      rc=$?
      # 0 = nothing fixable, 1 = fixable findings (the policy verdict). Anything else is the
      # scanner failing to reach a verdict, and that must not be published as a result.
      if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then
        note "trivy exited ${rc} on ${ref} — this run cannot claim a verdict"
        incomplete=1
        continue
      fi

      trivy_run "${slug}.all.json" 0 "$ref"
      rc=$?
      if [ "$rc" -ne 0 ]; then
        note "trivy visibility pass exited ${rc} on ${ref} — this run cannot claim a total"
        incomplete=1
        continue
      fi

      fixable="$(jq -r '[.Results[]?.Vulnerabilities[]?] | length' "$fix_json" 2>/dev/null)"
      total="$(jq -r '[.Results[]?.Vulnerabilities[]?] | length' "$all_json" 2>/dev/null)"
      top="$(jq -r '
        [.Results[]?.Vulnerabilities[]?] as $v
        | ($v | group_by(.PkgName) | map({ pkg: .[0].PkgName, n: length })
           | sort_by(-.n, .pkg) | .[0:3] | map("\(.pkg) (\(.n))") | join(", "))
      ' "$all_json" 2>/dev/null)"
      case "$fixable$total" in
        ''|*[!0-9]*) note "could not read trivy's JSON for ${ref}"; incomplete=1; continue ;;
      esac
      [ -n "$top" ] || top="—"

      printf '%s\t%s\n' "$ref" "$fixable" >> "$OUT_DIR/fixable.tsv"
      printf '%s\t%s\t%s\n' "$ref" "$total" "$top" >> "$OUT_DIR/total.tsv"
      fixable_total=$((fixable_total + fixable))
      scanned=$((scanned + 1))
      printf '  %-72s fixable=%-3s total=%-3s %s\n' "$ref" "$fixable" "$total" "$top"
    done

    if [ "$incomplete" -ne 0 ] || [ "$scanned" -ne "${#refs[@]}" ]; then
      # No state file: `report` reads its absence as INCOMPLETE, so the issue cannot keep
      # showing yesterday's table as if it were tonight's.
      die "scan incomplete — ${scanned}/${#refs[@]} refs produced a verdict" 2
    fi

    printf '%s\n' "$fixable_total" > "$OUT_DIR/fixable-total"
    if [ "$fixable_total" -gt 0 ]; then
      printf 'findings\n' > "$OUT_DIR/state"
      note "${fixable_total} fixable CRITICAL/HIGH across ${scanned} refs"
      exit 1
    fi
    printf 'clean\n' > "$OUT_DIR/state"
    note "no fixable CRITICAL/HIGH across ${scanned} refs"
    ;;

  drift)
    mapfile -t refs < <(load_refs)
    if [ "${#refs[@]}" -eq 0 ]; then
      die "no refs to check for drift — an empty inventory is an error, not a pass" 1
    fi
    mkdir -p "$OUT_DIR"
    : > "$OUT_DIR/drift.tsv"

    # The digest a tag serves NOW. Comparison is index-digest to index-digest: the pins in the
    # compose files are the multi-arch manifest-list digests the registries hand out, so a
    # platform manifest digest here would report drift on every ref forever (measured: all 13
    # refs match on 2026-10-25, which is what makes the equality meaningful).
    accept='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'

    # resolve_digest <ref> -> prints "status<TAB>current<TAB>reason"
    resolve_digest() {
      local ref="$1" name tag base first host repo token url hdr code cur try retry_after
      name="${ref%%@sha256:*}"
      tag="${name##*:}"
      base="${name%:*}"
      case "$base" in
        */*) ;;
        *) base="library/${base}" ;;
      esac
      first="${base%%/*}"
      if [[ "$first" == *.* || "$first" == *:* ]]; then
        host="$first"; repo="${base#*/}"
      else
        host="registry-1.docker.io"; repo="$base"
      fi

      case "$host" in
        ghcr.io)
          token="$(curl -fsS --max-time 20 "https://ghcr.io/token?scope=repository:${repo}:pull&service=ghcr.io" 2>/dev/null | jq -r '.token // empty' 2>/dev/null)"
          url="https://ghcr.io/v2/${repo}/manifests/${tag}"
          ;;
        registry-1.docker.io|docker.io|index.docker.io)
          token="$(curl -fsS --max-time 20 "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" 2>/dev/null | jq -r '.token // empty' 2>/dev/null)"
          url="https://registry-1.docker.io/v2/${repo}/manifests/${tag}"
          ;;
        *)
          printf 'unknown\t-\tregistry %s not supported by this check\n' "$host"; return 0 ;;
      esac
      if [ -z "$token" ] || [ "$token" = "null" ]; then
        printf 'unknown\t-\tanonymous token refused (401) — repo is not public or not ours\n'; return 0
      fi

      hdr="$(mktemp)"
      try=0
      while :; do
        try=$((try + 1))
        code="$(curl -sS --max-time 30 -o /dev/null -D "$hdr" -w '%{http_code}' \
          -H "Authorization: Bearer ${token}" -H "Accept: ${accept}" "$url" 2>/dev/null)" || code="000"
        case "$code" in
          200|204|206) ;;
          429)
            # Docker Hub throttles anonymous pulls hard; back off the way the header asks, then
            # give up as `unknown` — a rate limit is not evidence of being current.
            retry_after="$(tr -d '\r' < "$hdr" | awk -F': ' 'tolower($1)=="retry-after"{print $2; exit}')"
            case "$retry_after" in ''|*[!0-9]*) retry_after=5 ;; esac
            [ "$retry_after" -gt 20 ] && retry_after=20
            if [ "$try" -ge 3 ]; then
              rm -f "$hdr"; printf 'unknown\t-\trate limited (429) after %d attempts\n' "$try"; return 0
            fi
            note "rate limited on ${ref}; retrying in ${retry_after}s"
            sleep "$retry_after"; continue ;;
          401|403)
            rm -f "$hdr"; printf 'unknown\t-\tregistry refused the read (%s) — not a repo we can inspect\n' "$code"; return 0 ;;
          404)
            rm -f "$hdr"; printf 'unknown\t-\ttag %s not found (%s)\n' "$tag" "$code"; return 0 ;;
          *)
            rm -f "$hdr"; printf 'unknown\t-\tregistry answered %s\n' "$code"; return 0 ;;
        esac
        cur="$(tr -d '\r' < "$hdr" | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2; exit}')"
        rm -f "$hdr"
        if [ -z "$cur" ]; then
          printf 'unknown\t-\tregistry sent no digest header\n'; return 0
        fi
        if [ "$cur" = "${ref##*@}" ]; then
          printf 'ok\t%s\t-\n' "$cur"
        else
          printf 'drift\t%s\ttag now serves %s\n' "$cur" "${cur:0:19}…"
        fi
        return 0
      done
    }

    use_ok=0; use_drift=0; use_unknown=0
    for ref in "${refs[@]}"; do
      IFS=$'\t' read -r status cur reason < <(resolve_digest "$ref")
      pinned="${ref##*@}"
      printf '%s\t%s\t%s\t%s\t%s\n' "$ref" "$pinned" "${cur:-"-"}" "$status" "$reason" >> "$OUT_DIR/drift.tsv"
      case "$status" in
        ok) use_ok=$((use_ok + 1)) ;;
        drift) use_drift=$((use_drift + 1)); printf '  DRIFT %s\n' "$ref" ;;
        *) use_unknown=$((use_unknown + 1)); printf '  unknown %s (%s)\n' "$ref" "$reason" ;;
      esac
    done
    printf '%d refs: %d up to date, %d drifted, %d unknown\n' \
      "${#refs[@]}" "$use_ok" "$use_drift" "$use_unknown" >&2
    # Drift is advisory: it never fails the run. A tag that moved is a prompt to look, not a
    # build break — the failure signal for this workflow is a fixable CVE.
    ;;

  report)
    mkdir -p "$OUT_DIR"
    # LC_ALL=C: the default locale here is Thai Buddhist, so `%Y` would print 2569 for 2026 and
    # the issue would carry a year nobody can reconcile with the run it links to.
    at="$(LC_ALL=C date -u +%Y-%m-%dT%H:%M:%SZ)"
    day="$(LC_ALL=C date -u +%Y-%m-%d)"
    refs_count=0
    [ -f "$OUT_DIR/total.tsv" ] && refs_count="$(wc -l < "$OUT_DIR/total.tsv" | tr -d ' ')"
    fixable_total="$(cat "$OUT_DIR/fixable-total" 2>/dev/null || printf '?')"
    state="$(cat "$OUT_DIR/state" 2>/dev/null | tr -d '[:space:]')"
    drift_drift=0; drift_unknown=0
    if [ -f "$OUT_DIR/drift.tsv" ]; then
      drift_drift="$(awk -F'\t' '$4=="drift"' "$OUT_DIR/drift.tsv" | wc -l | tr -d ' ')"
      drift_unknown="$(awk -F'\t' '$4=="unknown"' "$OUT_DIR/drift.tsv" | wc -l | tr -d ' ')"
    fi

    # The hidden marker is the machine-readable half of the body: it carries the state, the
    # counts and the run id, so a reader (or a later run) can tell a table from tonight's scan
    # from one left behind by a run that crashed.
    marker="<!-- image-scan:state=${state:-incomplete} refs=${refs_count} fixable=${fixable_total} drift=${drift_drift} unknown=${drift_unknown} at=${at} run=${RUN_URL:-none} -->"

    # repo:tag@sha256:<12>… — enough to recognise the image, short enough to keep the table
    # readable in an issue. The full digest is in the compose file; this is a pointer, not a pin.
    image_short() {
      local name="${1%%@*}" digest="${1##*@}"
      printf '%s@%s…' "$name" "${digest:0:19}"
    }

    write_table() {
      printf '| image | fixable | CRITICAL/HIGH | top packages |\n|---|---|---|---|\n'
      [ -f "$OUT_DIR/total.tsv" ] || return 0
      # Worst first: a reader scanning the table sees what to bump, not alphabetical order.
      sort -t$'\t' -k2,2nr "$OUT_DIR/fixable.tsv" 2>/dev/null | while IFS=$'\t' read -r ref n; do
        total="$(awk -F'\t' -v r="$ref" '$1==r{print $2}' "$OUT_DIR/total.tsv")"
        top="$(awk -F'\t' -v r="$ref" '$1==r{print $3}' "$OUT_DIR/total.tsv")"
        printf '| `%s` | %s | %s | %s |\n' "$(image_short "$ref")" "$n" "${total:-?}" "${top:-—}"
      done
    }

    write_drift() {
      [ -f "$OUT_DIR/drift.tsv" ] || { printf '_drift check did not run_\n'; return 0; }
      printf '| image | pinned | registry now | status |\n|---|---|---|---|\n'
      while IFS=$'\t' read -r ref pinned cur status reason; do
        case "$status" in
          ok) verdict="up to date" ;;
          drift) verdict="**drift** — a newer image is published" ;;
          *) verdict="unknown — ${reason}" ;;
        esac
        printf '| `%s` | `%s` | `%s` | %s |\n' "$(image_short "$ref")" "${pinned:7:12}…" "${cur:7:12}…" "$verdict"
      done < "$OUT_DIR/drift.tsv"
    }

    {
      printf '%s\n\n' "$marker"
      case "$state" in
        findings)
          printf '## Fixable CRITICAL/HIGH in pinned images\n\n'
          printf '**%s fixable findings across %s pinned third-party images** — scanned %s' "$fixable_total" "$refs_count" "$at"
          [ -n "$RUN_URL" ] && printf ' ([run log](%s))' "$RUN_URL"
          printf '.\n\n'
          write_table
          printf '\n### Digest drift\n\n'
          write_drift
          printf '\n### What to do\n\n'
          printf -- '- **A fixable CVE**: bump that image'"'"'s digest to the tag'"'"'s current one (see `docker buildx imagetools inspect <ref>`), one image per commit; the pin policy is `docs/decisions/image-digest-pinning.md`.\n'
          printf -- '- **Cannot bump yet** (no fixed release in a usable tag): file a waiver in `security_waivers` with a `review_by` date — the only suppression mechanism, rendered to `.trivyignore` by CI. Do not add a second ignore file.\n'
          printf -- '- **Drift**: a newer build of the tag you already run exists. Bumping the digest is the cheap win — it usually clears this table on its own.\n'
          printf -- '- **unknown**: the registry could not be read (rate limit, private repo). Not a claim that the image is current.\n'
          ;;
        clean)
          printf 'Clean as of %s — 0 fixable CRITICAL/HIGH across %s pinned third-party images.\n' "$day" "$refs_count"
          ;;
        *)
          printf '> **INCOMPLETE RUN — the result below is NOT current.**\n>\n'
          printf '> The scan did not finish at %s UTC, so this issue does not carry a fresh verdict. ' "${at%Z}Z"
          printf 'The previous table was replaced on purpose rather than left standing: a stale body reads as a current one.\n'
          [ -n "$RUN_URL" ] && printf '> Run log: %s\n' "$RUN_URL"
          ;;
      esac
    } > "$OUT_DIR/issue.md"

    # The job summary always lists every ref with its counts, whatever the verdict — that is how
    # the unfixed tail stays visible without a red run. On an incomplete run it says so instead.
    {
      printf '## Nightly image scan — %s UTC\n\n' "${at%Z}Z"
      if [ -f "$OUT_DIR/total.tsv" ]; then
        printf '**%s pinned third-party refs scanned**, %s fixable CRITICAL/HIGH (waivers applied).\n\n' "$refs_count" "$fixable_total"
        write_table
      else
        printf '**No scan table** — the run did not produce a verdict. Nothing below is a claim of being current.\n'
      fi
      printf '\n### Digest drift (registry now vs the pin)\n\n'
      write_drift
    } > "$OUT_DIR/summary.md"

    cat "$OUT_DIR/summary.md"
    ;;
esac
