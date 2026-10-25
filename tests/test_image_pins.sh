#!/usr/bin/env bash
# tests/test_image_pins.sh — every third-party image reference is pinned to tag@sha256.
#
# WHY this gate exists: a floating tag is a supply-chain input that changes without a commit.
# `postgres:15` or `nginx:alpine` re-resolve to whatever the registry serves today, so the stack
# that passed review is not the stack that starts tomorrow, and nothing in git records the
# difference. The policy — the decision, the readable-tag rule, and why our own images are
# exempt — lives in docs/decisions/image-digest-pinning.md, which is the single place to read
# or change it; this suite is only the enforcement.
#
# WHAT it asserts, per `image:` line in every compose file the repo ships
# (docker-compose*.yml and docker/docker-compose*.yml, the same globs `make lint` and the CI
# compose loop walk):
#   1. a third-party image carries `@sha256:` — a digest, not just a tag;
#   2. that digest is exactly 64 lowercase hex characters — a truncated or fabricated digest
#      otherwise parses fine in compose and only fails at pull time, on the target host;
#   3. the tag before the digest is concrete: `:latest` and untagged refs are rejected, because
#      both mean "whatever the registry has now" and neither can be reviewed as a change;
#   4. two references to the same repo:tag carry the SAME digest, so there is one pin per image
#      even though the string appears wherever it is used;
#   5. our own `ghcr.io/champyod/*` images are exempt, still carry ${IMG_TAG}, and the file says
#      why (the sentinel comment checked below) — a digest there would freeze a deploy to one
#      build, since the tag is how a deploy selects the build CI just pushed.
#
# `--list` prints the inventory (repo:tag<TAB>sha256:digest, one line per distinct pin) so the
# table in the decision record can be regenerated from the tree instead of hand-maintained.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ADR="${REPO_ROOT}/docs/decisions/image-digest-pinning.md"
# Files the decision record's prose lives behind; the suite fails if an exempt image has no
# explanation beside it, so the exemption cannot be smuggled in silently.
SENTINEL='WHY no digest on our own images'

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# ── inventory ────────────────────────────────────────────────────────────────────────────────
# WHY `*generated*` is skipped: `./cms config sync` writes docker-compose.*.generated.yml from
# the service registry at run time. Those files are untracked operator artifacts, not something
# this repository ships, and the registry rows they mirror are the operator's to pin.
# WHY a git-ignored file is skipped too: docker-compose.expose.yml is a deployment artifact the
# operator generates on the host (it is in .gitignore), so it is not repository content and its
# image lines are not this gate's to police.
COMPOSE_FILES=()
for f in "${REPO_ROOT}"/docker-compose*.yml "${REPO_ROOT}"/docker/docker-compose*.yml; do
  [ -f "$f" ] || continue
  case "$f" in *generated*) continue ;; esac
  if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 &&
     git -C "$REPO_ROOT" check-ignore -q -- "$f"; then
    continue
  fi
  COMPOSE_FILES+=("$f")
done

if [ "${#COMPOSE_FILES[@]}" -eq 0 ]; then
  no "found no compose files to scan (run from the repository root)"
fi

# repo:tag -> digest, so a second reference to the same image cannot disagree with the first.
declare -A digest_of=()
total=0
third_party=0
ours=0

# image_value <raw yaml value> -> the reference to judge, with the ${VAR:-default} wrapper
# unwrapped (an interpolated default is still the image a deploy runs when the var is unset).
image_value() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"           # ltrim
  v="${v%"${v##*[![:space:]]}"}"           # rtrim
  v="${v%%[[:space:]]#*}"                  # trailing `# comment`
  v="${v%\"}"; v="${v#\"}"                 # double quotes
  v="${v%\'}"; v="${v#\'}"                 # single quotes
  v="${v%"${v##*[![:space:]]}"}"           # rtrim again (quote before comment)
  if [[ "$v" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.+)\}$ ]]; then
    v="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$v"
}

for f in "${COMPOSE_FILES[@]}"; do
  rel="${f#"${REPO_ROOT}/"}"
  printf '\n%s\n' "$rel"
  while IFS= read -r hit; do
    lineno="${hit%%:*}"
    raw="${hit#*:}"
    raw="${raw#*image:}"
    ref="$(image_value "$raw")"
    total=$((total + 1))

    # Our own images: selected by tag, pinned by CI's build, exempt by policy.
    if [[ "$ref" == ghcr.io/champyod/* ]]; then
      ours=$((ours + 1))
      if [[ "$ref" == *'${IMG_TAG'* ]]; then
        ok "${rel}:${lineno} own image selected by \${IMG_TAG} (${ref})"
      else
        no "${rel}:${lineno} own image is not \${IMG_TAG}-selected: ${ref}"
      fi
      if grep -qF -- "$SENTINEL" "$f"; then
        ok "${rel}:${lineno} states why own images carry no digest"
      else
        no "${rel} has an own image but no comment saying why it is unpinned"
      fi
      continue
    fi

    third_party=$((third_party + 1))

    if [[ "$ref" != *@sha256:* ]]; then
      no "${rel}:${lineno} third-party image has no digest: ${ref}"
      continue
    fi
    name_and_tag="${ref%%@sha256:*}"
    digest="${ref##*@sha256:}"
    if [[ "$digest" =~ ^[0-9a-f]{64}$ ]]; then
      ok "${rel}:${lineno} ${name_and_tag} pinned at sha256:${digest:0:12}…"
    else
      no "${rel}:${lineno} digest is not 64 lowercase hex chars: ${digest}"
    fi

    last="${name_and_tag##*/}"
    if [[ "$last" != *:* ]] || [ -z "${last##*:}" ]; then
      no "${rel}:${lineno} third-party image is untagged: ${ref}"
      continue
    fi
    tag="${last##*:}"
    if [ "$tag" = "latest" ]; then
      no "${rel}:${lineno} third-party image floats on :latest: ${ref}"
    fi

    # Normalise the docker.io/library spellings so `postgres:15` and `docker.io/postgres:15`
    # are recognised as the same image and must therefore carry the same digest.
    key="${name_and_tag}"
    key="${key#docker.io/library/}"; key="${key#docker.io/}"; key="${key#library/}"
    if [ -n "${digest_of[$key]:-}" ]; then
      if [ "${digest_of[$key]}" != "$digest" ]; then
        no "${rel}:${lineno} ${key} carries two different digests (${digest_of[$key]:0:12}… vs ${digest:0:12}…)"
      else
        ok "${rel}:${lineno} ${key} repeats the same digest as its other reference"
      fi
    else
      digest_of["$key"]="$digest"
    fi
  done < <(grep -nE '^[[:space:]]*image:[[:space:]]*' "$f")
done

# ── Dockerfiles: a FROM is an image reference too ───────────────────────────────────────────
# WHY this half exists: the compose-only scan let `admin-panel/Dockerfile` name
# `node:20-bookworm-slim` with no digest for the whole life of the pin policy, while
# docker/scheduler/Dockerfile pinned its own — and nothing failed. A base image selected by tag
# can change between two builds of the same commit with no PR, which is exactly what pinning is
# for, and it is the path a runtime CVE takes into the image.
printf '\nthe Dockerfiles pin their bases too\n'
dfrom_total=0
dfrom_third=0
dfrom_ours=0
# `find`, not `git ls-files`: the gate has to answer the same way from an exported tree as from a
# checkout, and a scan that silently covers nothing because git is absent is the failure mode this
# whole section exists to prevent. Build artifacts are pruned by path, not by trusting .gitignore.
for f in $(cd "$REPO_ROOT" && find . -name Dockerfile -not -path './node_modules/*' \
             -not -path '*/.git/*' -not -path '*/.next/*' -not -path '*/node_modules/*' | sed 's|^\./||'); do
  while IFS= read -r line; do
    ref="$(printf '%s' "$line" | awk '{print $2}')"
    # `FROM base AS build` style references a previous stage, not a registry image.
    case "$ref" in
      *"$SENTINEL"*|*"\$"*) continue ;;
    esac
    if printf '%s' "$line" | grep -qE '^[[:space:]]*FROM[[:space:]]+[A-Za-z0-9_.-]+([[:space:]]+AS[[:space:]]+[A-Za-z0-9_-]+)?[[:space:]]*$' \
       && ! printf '%s' "$ref" | grep -q '[/:]'; then
      continue
    fi
    dfrom_total=$((dfrom_total + 1))
    if printf '%s' "$ref" | grep -qE '^ghcr\.io/champyod/'; then
      dfrom_ours=$((dfrom_ours + 1))
      continue
    fi
    dfrom_third=$((dfrom_third + 1))
    img="${ref%@*}"
    if ! printf '%s' "$ref" | grep -qE '@sha256:[0-9a-f]{64}$'; then
      no "${f}: FROM ${img} has no @sha256 digest — the base can change under a build with no PR"
    elif printf '%s' "$img" | grep -qE ':(latest)?$'; then
      no "${f}: FROM ${img} is tagged latest"
    else
      ok "${f}: ${img} is pinned by digest"
    fi
  done < <(grep -iE '^[[:space:]]*FROM[[:space:]]' "$REPO_ROOT/$f")
done
if [ "$dfrom_total" -eq 0 ]; then
  no "no FROM lines matched — the Dockerfile scan is broken, not the tree"
fi
if [ "$dfrom_third" -gt 0 ]; then
  ok "scanned ${dfrom_total} FROM lines: ${dfrom_third} third-party, ${dfrom_ours} our own"
else
  no "no third-party FROM lines found — the exemption filter is swallowing everything"
fi

# ── the decision record ─────────────────────────────────────────────────────────────────────
printf '\nthe decision lives in one place\n'
if [ -f "$ADR" ]; then
  ok "docs/decisions/image-digest-pinning.md exists"
  if grep -qF -- "$SENTINEL" "$ADR"; then
    ok "the record states why our own images are exempt"
  else
    no "the record does not state the own-image exemption"
  fi
  if grep -qF -- 'IMG_TAG' "$ADR"; then
    ok "the record names the selector (\${IMG_TAG}) the exemption is about"
  else
    no "the record does not name \${IMG_TAG}"
  fi
else
  no "docs/decisions/image-digest-pinning.md is missing — the pin policy has no home"
fi

# ── inventory mode ──────────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--list" ]; then
  printf '\n%s\t%s\n' "image:tag" "digest"
  for key in "${!digest_of[@]}"; do
    printf '%s\tsha256:%s\n' "$key" "${digest_of[$key]}"
  done | sort
fi

printf '\n%d image references: %d third-party, %d our own, %d distinct pins\n' \
  "$total" "$third_party" "$ours" "${#digest_of[@]}"
if [ "$total" -eq 0 ]; then
  no "no image references matched — the scan, not the tree, is broken"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
