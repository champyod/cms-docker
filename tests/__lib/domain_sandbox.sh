#!/usr/bin/env bash
# tests/__lib/domain_sandbox.sh — one copy of the sandbox every domain test needs.
#
# Why shared: five tests each built their own private copy of the same setup, so a change
# to how scripts are sourced had to be repeated in five places.

# Paths the sandbox is built from; set by the test that sources this file.
DOMAIN="${DOMAIN:-}"
REPO_ROOT="${REPO_ROOT:-}"
SANDBOXES=()

# Creates a sandbox and prints its path: a copy of __domain.sh plus every file it
# sources, so a run can never touch the real certificate store. Stub clients are the
# caller's business — each test exercises a different failure.
domain_sandbox() {
  local dir
  dir="$(mktemp -d)"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts" "${dir}/config" "${dir}/bin"
  cp "${DOMAIN}" "${dir}/scripts/"
  # WHY recursive and both spellings: a sourced file may be sourced by `.` rather than
  # `source`, and may itself source another (the route table pulls in the SSE and
  # panel-colour snippets). One level with one spelling left those off the copy, and the
  # script then died reading a file the sandbox never had.
  _domain_sandbox_copy_sources "${DOMAIN}" "${dir}"
  cp "${REPO_ROOT}/config.toml.example" "${dir}/config.toml"
  printf '%s' "${dir}"
}

_domain_sandbox_copy_sources() {
  local script="$1" dir="$2" sourced
  while read -r sourced; do
    [[ -e "${dir}/scripts/${sourced}" ]] && continue
    [[ -e "${REPO_ROOT}/scripts/${sourced}" ]] || continue
    mkdir -p "${dir}/scripts/$(dirname "${sourced}")"
    cp -r "${REPO_ROOT}/scripts/${sourced}" "${dir}/scripts/${sourced}"
    _domain_sandbox_copy_sources "${REPO_ROOT}/scripts/${sourced}" "${dir}"
  done < <(grep -oE 'source "[^"]+"|\. "[^"]+"' "${script}" | cut -d/ -f2- | tr -d '"' | sort -u)
}

# Removes every sandbox this run created. Safe with none created.
domain_sandbox_cleanup() {
  rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"
}
