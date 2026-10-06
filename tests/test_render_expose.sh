#!/usr/bin/env bash
# Drives scripts/__render_expose.sh so its real resolver is exercised.
#
# WHY a shell test and not a Rust one: the Rust TUI only ever writes the *_BIND_IP
# keys; it never runs the resolver that turns them into published port entries. A Rust
# test would assert the key was written and stay green while the resolver published a
# peer port on a public address. This test reads the emitted compose file instead, and
# its final case asserts the one property that must never regress: a peer service
# (postgres, the RPC services, the worker) can never end up on a public address.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RENDER="${REPO_ROOT}/scripts/__render_expose.sh"

pass=0
fail=0
# One tree per run rather than one per case: the cases only read .env, so they can
# share the copy, and the trap is what guarantees the cleanup on an interrupted run.
SANDBOXES=()

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# WHY a copy at all: the script resolves REPO_ROOT from its own location and writes
# docker-compose.expose.yml there, so running it in place would let a mistake drop a
# stray override into the real tree. It needs no other file, so the copy is minimal.
sandbox() {
  local dir
  dir="$(mktemp -d)"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts"
  cp "${RENDER}" "${dir}/scripts/"
  printf '%s' "${dir}"
}

# Runs the resolver against the .env written into the sandbox and echoes the override path.
render() {
  local dir="$1"
  ( cd "${dir}" && bash scripts/__render_expose.sh >/dev/null 2>&1 || true )
  printf '%s' "${dir}/docker-compose.expose.yml"
}

echo "case 1: a comma list publishes one entry per address"
dir="$(sandbox)"
cat > "${dir}/.env" <<'ENV'
ADMIN_BIND_IP=203.0.113.10,100.64.0.1
ENV
out="$(render "${dir}")"
if grep -q '"203.0.113.10:8889:8889"' "${out}" && grep -q '"100.64.0.1:8889:8889"' "${out}"; then
  ok "admin-web-server publishes on both addresses"
else
  no "admin-web-server publishes on both addresses"
fi

echo "case 2: nothing set means nothing emitted"
dir="$(sandbox)"
render "${dir}" >/dev/null
if [[ ! -e "${dir}/docker-compose.expose.yml" ]]; then
  ok "an empty .env writes no override"
else
  no "an empty .env writes no override"
fi

echo "case 3: a set *_BIND_IP wins and is emitted"
dir="$(sandbox)"
printf 'CONTEST_BIND_IP=203.0.113.10\n' > "${dir}/.env"
out="$(render "${dir}")"
if grep -q '"203.0.113.10:8888:8888"' "${out}"; then
  ok "contest-web-server follows CONTEST_BIND_IP"
else
  no "contest-web-server follows CONTEST_BIND_IP"
fi

echo "case 4: peer services bind the inner address, never a public one"
dir="$(sandbox)"
# WHY PUBLIC_IP=0.0.0.0 is present: it is the value that would publish every port on
# every interface if anything fell back to it, which is exactly the regression this
# case exists to catch.
cat > "${dir}/.env" <<'ENV'
INNER_IP=100.64.0.1
ADMIN_BIND_IP=203.0.113.10
PUBLIC_IP=0.0.0.0
ENV
out="$(render "${dir}")"
bad=0
for port in 5432 22000 25000 26000 28000 28500 28600 29000; do
  grep -q "\"203.0.113.10:${port}:" "${out}" && bad=1
  grep -q "\"0.0.0.0:${port}:" "${out}" && bad=1
done
if (( bad == 0 )); then
  ok "no peer port binds a public address"
else
  no "no peer port binds a public address"
fi
if grep -q '"100.64.0.1:29000:29000"' "${out}"; then
  ok "an RPC service follows INNER_IP"
else
  no "an RPC service follows INNER_IP"
fi
# The front door is expected to take the public address, so this is the sanity check
# that the resolver did publish something at all rather than silently emitting nothing.
if grep -q '"203.0.113.10:8889:8889"' "${out}"; then
  ok "the front door still follows its own key"
else
  no "the front door still follows its own key"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
(( fail == 0 ))
