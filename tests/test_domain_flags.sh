#!/usr/bin/env bash
# Drives scripts/__domain.sh so its real parser is exercised.
#
# WHY this exists as a shell test and not a Rust one: every Rust test over the domain
# flags asserts an argv vector it built itself. None of them reads the script's `case`
# arms, so renaming a flag there, or adding a verb the CLI cannot reach, leaves the whole
# suite green. This test asks the script directly instead.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN="${REPO_ROOT}/scripts/__domain.sh"

pass=0
fail=0
# Every sandbox this run created. A single tree per run instead of one per case: the
# cases only read, so they can share it, and a run that made ~30 copies of the repo's
# scripts filled a 7G tmpfs. The trap is what guarantees the cleanup — without it an
# interrupted run leaves the whole set behind.
SANDBOXES=()

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# Copies only what the script actually reaches for, so a run can never write to the real
# repo while staying small enough to run anywhere.
# WHY a copy at all: the script resolves REPO_ROOT from its own location, so exercising
# it in place would let a mistake in a test delete or rewrite a real certificate.
# WHY the file list is derived from the script's own `source` lines: a script that starts
# sourcing a fourth file would otherwise fail every case with "No such file", which reads
# as a broken script rather than a broken test.
sandbox() {
  local dir
  dir="$(mktemp -d)"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts" "${dir}/config" "${dir}/bin"
  cp "${DOMAIN}" "${dir}/scripts/"
  # WHY the pattern keeps `/` inside the captured name: the script sources
  # `__lib/common.sh` as well as a sibling, so a pattern that stopped at the first `/`
  # would drop the library and every case would fail at line 28 with "No such file".
  # WHY `..` is excluded rather than filtered afterwards: it only ever appears in the
  # script's own location calculation, never in a `source` target, so requiring a real
  # file inside scripts/ is what keeps the copy from pulling in the whole repository.
  while read -r sourced; do
    [[ -e "${REPO_ROOT}/scripts/${sourced}" ]] || continue
    # WHY the parent directory is created first: a sourced path can carry its own
    # subdirectory (`__lib/common.sh`), and `cp -r scripts/__lib sandbox/scripts/` would
    # land it as `sandbox/scripts/common.sh` — present, but not where the script looks.
    mkdir -p "${dir}/scripts/$(dirname "${sourced}")"
    cp -r "${REPO_ROOT}/scripts/${sourced}" "${dir}/scripts/${sourced}"
  done < <(grep -oE 'source "[^"]+"' "${DOMAIN}" \
    | cut -d/ -f2- | tr -d '"' | sort -u)
  cp "${REPO_ROOT}/config.toml.example" "${dir}/config.toml"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/docker"
  chmod +x "${dir}/bin"/*
  printf '%s' "${dir}"
}

# WHY `domain` and `email` on every call: letsencrypt refuses to run without an email, and
# the refusal happens before the part of the sequence under test.
run_in() {
  local dir="$1"
  shift
  PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" "$@" \
    --domain example.org --email ops@example.org 2>&1
}

echo "domain verbs"
for verb in setup cert proxy status renew preflight check-expiry revoke; do
  out="$(run_in "$(sandbox)" "${verb}" --dry-run)"
  if grep -q 'unknown command' <<<"${out}"; then
    no "verb '${verb}' is dispatched"
  else
    ok "verb '${verb}' is dispatched"
  fi
done

echo "flags the CLI advertises reach the parser"
# WHY each one is listed rather than derived: the point is to catch a rename in either
# direction. A flag the script dropped shows up here as an unknown-option failure.
for flag in \
  --auto-retry --retry-forever --staging --force --backup-certs --lock \
  --auto-renew --yes --apply
do
  dir="$(sandbox)"
  out="$(run_in "${dir}" setup --dry-run "${flag}")"
  if grep -q 'unknown option' <<<"${out}"; then
    no "setup accepts ${flag}"
  else
    ok "setup accepts ${flag}"
  fi
done

echo "flags taking a value"
for pair in \
  '--retry-attempts 3' '--retry-interval 20' '--wait-port80 60' \
  '--extra-domains a.example.org' '--dns cloudflare' \
  '--dns-credentials /tmp/creds.ini' '--deploy-hook reload-nginx' \
  '--cert provided' '--cert-path /tmp/f.pem' '--key-path /tmp/k.pem'
do
  dir="$(sandbox)"
  # shellcheck disable=SC2086
  out="$(run_in "${dir}" setup --dry-run ${pair})"
  if grep -q 'unknown option' <<<"${out}"; then
    no "setup accepts ${pair}"
  else
    ok "setup accepts ${pair}"
  fi
done

echo "the scope is the verb, not a flag"
dir="$(sandbox)"
if grep -q 'unknown option: --cert-only' <<<"$(run_in "${dir}" setup --dry-run --cert-only)"; then
  ok "--cert-only was removed"
else
  no "--cert-only was removed"
fi
if grep -q 'unknown option: --proxy-only' <<<"$(run_in "${dir}" setup --dry-run --proxy-only)"; then
  ok "--proxy-only was removed"
else
  no "--proxy-only was removed"
fi

echo "each verb touches only its own half"
dir="$(sandbox)"
cert_out="$(run_in "${dir}" cert --dry-run)"
proxy_out="$(run_in "${dir}" proxy --dry-run)"
# WHY these greps rather than a diff: the two runs log different scope banners by design,
# so the assertion has to be about which subsystem each one mentions.
if grep -qi certbot <<<"${cert_out}" && ! grep -q 'nginx config is neither' <<<"${proxy_out}" \
   && grep -q 'nginx config is neither' <<<"${cert_out}"; then
  ok "cert issues and cert does not render nginx"
else
  no "cert issues and cert does not render nginx"
fi
if grep -qi nginx <<<"${proxy_out}" && ! grep -qi certbot <<<"${proxy_out}"; then
  ok "proxy renders nginx and proxy does not issue"
else
  no "proxy renders nginx and proxy does not issue"
fi

echo "--auto-renew honours the scope"
dir="$(sandbox)"
if grep -q 'auto-renew' <<<"$(run_in "${dir}" setup --dry-run --auto-renew)"; then
  ok "setup --auto-renew announces a renewal"
else
  no "setup --auto-renew announces a renewal"
fi
# WHY cert is excluded: cmd_renew reloads nginx, and cert promises nginx is untouched.
if grep -q 'auto-renew' <<<"$(run_in "${dir}" cert --dry-run --auto-renew)"; then
  no "cert --auto-renew stays silent"
else
  ok "cert --auto-renew stays silent"
fi
if grep -q 'auto-renew' <<<"$(run_in "${dir}" setup --dry-run)"; then
  no "a bare setup does not renew"
else
  ok "a bare setup does not renew"
fi

echo "invalid values are refused"
dir="$(sandbox)"
if grep -qi 'non-negative integer' <<<"$(run_in "${dir}" setup --dry-run --retry-attempts abc)"; then
  ok "--retry-attempts rejects a non-number"
else
  no "--retry-attempts rejects a non-number"
fi
# WHY this pair matters: a value carrying a space has to reach the script as ONE argument.
# If it arrived as two, `ok` would be parsed as an unknown option and the operator would
# see a parser error instead of their command.
if grep -q 'unknown option' <<<"$(run_in "${dir}" setup --dry-run --deploy-hook 'echo ok')"; then
  no "a hook with a space arrives as one argument"
else
  ok "a hook with a space arrives as one argument"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
(( fail == 0 ))