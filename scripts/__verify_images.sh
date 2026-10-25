#!/usr/bin/env bash
# scripts/__verify_images.sh — refuse to deploy an image this repository did not sign.
#
# WHAT IT DECIDES: whether every image the requested stack is about to pull carries
# a cosign keyless signature made by this repository's own release workflow, against
# the expected OIDC issuer and identity. An image that does not verify stops the
# deploy with a named reason, before anything is pulled or recreated.
#
# WHY THIS FILE, AND WHY THE MAKEFILE CALLS IT: `./cms deploy <stack> [--img]` runs
# no compose command of its own — tools/cms-tui/src/core/docker.rs runs
# `make <stack>` with DEPLOYMENT_TYPE_OVERRIDE=img, and `./cms update-server`
# (scripts/__update-server.sh) shells those same targets. The Makefile's img branch
# is therefore the one place every image-pulling deploy passes through, so the gate
# lives there — before `compose pull` — and not in a second deploy implementation.
#
# Usage: scripts/__verify_images.sh <image-ref> [<image-ref>...]
#   Refs come from `docker compose ... config --images`, so the gate reads the same
#   compose files the deploy is about to use rather than a second hardcoded list.
#
# Environment:
#   CMS_SIGNED_IMAGE_PREFIX
#       Which refs are ours. Default ghcr.io/champyod/cms-docker-
#       Anything outside it (postgres, redis, nginx: upstream base images this
#       repository neither builds nor can sign) is pulled as-is and only logged.
#   CMS_COSIGN_IDENTITY_REGEXP / CMS_COSIGN_OIDC_ISSUER
#       The identity a signature must carry. Defaults name this repository's
#       .github/workflows/ci.yml on its two deploy branches and the GitHub Actions
#       OIDC issuer, which is exactly what the build jobs sign with.
#   CMS_SKIP_IMAGE_VERIFY=1
#       EMERGENCY ONLY. See docs/IMAGE-VERIFICATION.md. Skips the whole gate and
#       says so loudly; it is the only way to deploy an unsigned image.
#   CMS_COSIGN_IMAGE
#       The pinned cosign used when the host has no cosign binary. Verification runs
#       in a container, so the gate needs no host install — which is what the
#       operator-manual host decision requires (P1=D): nothing lands on the box.
#
# Exit codes:
#   0  every image under the prefix verified (or there was nothing of ours to check)
#   2  no image refs were passed — the caller could not say what to check
#   3  neither a cosign binary nor a usable docker daemon (fail closed: an unchecked
#      image is not a verified one)
#   4  an image did not verify; the reason is printed as `reason=<name>`

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=/dev/null
source scripts/__lib/common.sh 2>/dev/null || true
declare -F log_info >/dev/null || log_info() { printf '[INFO] %s\n' "$*"; }
declare -F log_warn >/dev/null || log_warn() { printf '[WARN] %s\n' "$*" >&2; }
declare -F log_die  >/dev/null || log_die()  { printf '[FAIL] %s\n' "${1:-fatal error}" >&2; exit "${2:-1}"; }

IMAGE_PREFIX="${CMS_SIGNED_IMAGE_PREFIX:-ghcr.io/champyod/cms-docker-}"
IDENTITY_REGEXP="${CMS_COSIGN_IDENTITY_REGEXP:-^https://github\.com/champyod/cms-docker/\.github/workflows/ci\.yml@refs/heads/(main|major/admin-panel)\$}"
OIDC_ISSUER="${CMS_COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

# WHY the flag is spelled out in the log rather than silently honoured: an operator
# who reaches for it is trading the whole point of the gate for a deploy that works
# now, and the record of that trade has to exist somewhere they will see it.
if [[ "${CMS_SKIP_IMAGE_VERIFY:-}" == "1" ]]; then
  log_warn "CMS_SKIP_IMAGE_VERIFY=1 — image signature verification SKIPPED for this deploy."
  log_warn "reason=operator-override — the images this run upgrades to are UNVERIFIED."
  log_warn "Unset it and re-run as soon as the signed build is available. See docs/IMAGE-VERIFICATION.md."
  exit 0
fi

if [[ $# -lt 1 ]]; then
  log_die "reason=no-images — no image refs were passed, so nothing could be checked. A deploy that cannot be verified is not started." 2
fi

# WHY a container instead of requiring the binary: the hosts are operator-manual by
# decision, so a deploy that only works after someone installs a tool on the box is a
# host change wearing a deploy's clothes. The same pinned cosign runs from the registry,
# which also means the verifier's version is a reviewed value rather than whatever the
# operator happened to have.
COSIGN_IMAGE="${CMS_COSIGN_IMAGE:-ghcr.io/sigstore/cosign/cosign:v2.5.2@sha256:23d07b53d59a1233e1ab5e7d082cf4182fc90067d2f86a662ba3003215cb0c95}"

cosign_runner=""
if command -v cosign >/dev/null 2>&1; then
  cosign_runner="host"
elif docker info >/dev/null 2>&1; then
  cosign_runner="container"
fi

if [[ -z "$cosign_runner" ]]; then
  log_die "reason=no-verifier — neither a cosign binary nor a reachable docker daemon, so no image can be verified. For an emergency only, CMS_SKIP_IMAGE_VERIFY=1." 3
fi

# One place that shapes the argv, so the host and container paths cannot drift into
# verifying different things.
cosign_verify() {
  local image="$1"
  if [[ "$cosign_runner" == "host" ]]; then
    cosign verify "$image" \
      --certificate-identity-regexp "$IDENTITY_REGEXP" \
      --certificate-oidc-issuer "$OIDC_ISSUER"
  else
    # Read-only docker config: a private package needs the registry credential the
    # host already has, and cosign must not be able to rewrite it. `-i` keeps the
    # caller's stdin (an unattended deploy has none) from being consumed.
    local -a mount=()
    if [[ -d "${DOCKER_CONFIG:-$HOME/.docker}" ]]; then
      mount=(-v "${DOCKER_CONFIG:-$HOME/.docker}:/root/.docker:ro")
    fi
    docker run --rm -i "${mount[@]}" "$COSIGN_IMAGE" verify "$image" \
      --certificate-identity-regexp "$IDENTITY_REGEXP" \
      --certificate-oidc-issuer "$OIDC_ISSUER"
  fi
}

log_info "verifying image signatures against issuer ${OIDC_ISSUER} (verifier: ${cosign_runner})"

verified=0
upstream=0

for image in "$@"; do
  # Empty entries come from a compose file whose image list could not be read.
  [[ -n "$image" ]] || continue

  if [[ "$image" != "$IMAGE_PREFIX"* ]]; then
    log_info "not this repository's image, not verified: ${image}"
    upstream=$((upstream + 1))
    continue
  fi

  rc=0
  output=""
  # cosign exits non-zero for a missing signature, a wrong identity and a registry
  # failure alike, so the output is captured and classified instead of printed raw.
  set +e
  output="$(cosign_verify "$image" 2>&1)"
  rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    log_info "verified: ${image}"
    verified=$((verified + 1))
    continue
  fi

  # A named reason matters more than a stack trace: it is what tells an operator
  # whether the build never ran, ran on another branch, or the registry lied.
  reason="verify-failed"
  if grep -qiE 'none of the expected identities matched' <<<"$output"; then
    reason="identity-mismatch"
  elif grep -qiE 'no (matching )?signatures?( found| exist)?' <<<"$output"; then
    reason="no-signature"
  elif grep -qiE 'unauthorized|denied|MANIFEST_UNKNOWN|not found' <<<"$output"; then
    reason="registry-refused"
  fi

  printf '%s\n' "$output" | sed 's/^/    /' >&2
  log_die "reason=${reason} — ${image} did not verify against ${OIDC_ISSUER} as ${IDENTITY_REGEXP}. Refusing to pull or upgrade to it." 4
done

log_info "image signature check passed (${verified} verified, ${upstream} upstream image(s) not ours to sign)"
