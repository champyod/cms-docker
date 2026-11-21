#!/usr/bin/env bash
# tests/test_ci_signing_parity.sh — every build job must sign the image it pushes.
#
# WHY this exists: the admin panel job pushed `cms-docker-admin-panel` and signed
# `cms-docker-admin` — a repository with no image in it. cosign signs whatever digest it
# is handed, so the step reported success and CI stayed green while the image that
# actually ships carried no signature; the deploy gate then refused every panel deploy
# with `reason=no-signature`. Nothing compared the two values, so nothing could notice.
#
# The check reads the workflow the way the build does: per `build-and-push-*` job, the
# `images:` line of the metadata-action step and the `IMAGE:` of the signing step must
# name the same repository. A job that signs nothing is a failure too — an unsigned
# image is not deployable, so the signature is part of the deliverable.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CI="${REPO_ROOT}/.github/workflows/ci.yml"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$CI" ]]; then
  printf '  FAIL ci.yml is missing — nothing to check\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

# awk rather than a YAML library: the repo's shell suites carry no python dependency, and
# the two values sit at fixed indentation under their job key.
report="$(
  awk '
    /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { job = $1; sub(":", "", job) }
    /images: .*env.REGISTRY/          { if (job ~ /^build-and-push-/) push[job] = $0 }
    /IMAGE: .*env.REGISTRY/           { if (job ~ /^build-and-push-/) sign[job] = $0 }
    END {
      for (j in push) {
        p = push[j]; s = (j in sign) ? sign[j] : ""
        sub(/.*IMAGE_NAME \}\}/, "", p); sub(/.*IMAGE_NAME \}\}/, "", s)
        printf "%s\t%s\t%s\n", j, p, s
      }
    }' "$CI" | sort
)"

if [[ -z "$report" ]]; then
  no "no build-and-push job with a metadata images: line was found — the parse is broken, not the tree"
else
  jobs=0
  while IFS=$'\t' read -r job pushed signed; do
    [[ -n "$job" ]] || continue
    jobs=$((jobs + 1))
    if [[ -z "$signed" ]]; then
      no "${job} pushes ${pushed} but signs nothing — the image would not verify at deploy time"
    elif [[ "$pushed" != "$signed" ]]; then
      no "${job} pushes ${pushed} but signs ${signed} — the signature lands in a repository with no image"
    else
      ok "${job} signs the image it pushes (${pushed})"
    fi
  done <<<"$report"
  if [[ $jobs -eq 0 ]]; then
    no "no build jobs were compared — the parse found no rows"
  fi
fi

# The deploy gate refuses an image without a signature, so "signed" has to be part of
# every build job rather than a thing one job happens to do.
builds="$(grep -cE '^  build-and-push-.*:$' "$CI")"
signs="$(grep -cE '^ +cosign sign --yes' "$CI")"
if [[ "$builds" -gt 0 && "$signs" -ge "$builds" ]]; then
  ok "${signs} cosign sign step(s) for ${builds} build job(s)"
else
  no "${builds} build job(s) but only ${signs} cosign sign step(s)"
fi

# A signing step that can be skipped on the deploy branches is the same defect wearing a
# condition: these builds run on pull_request too, where signing is neither possible nor
# meaningful.
if grep -qE 'if: github\.event_name != .pull_request.' "$CI"; then
  ok "signing is limited to non-pull_request builds (where an OIDC token exists)"
else
  no "signing is not guarded against pull_request builds"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
