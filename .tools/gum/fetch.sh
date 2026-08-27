#!/usr/bin/env bash
# Vendor charmbracelet gum release binaries for both supported Linux arches.
# Usage: fetch.sh [version]   (default: 0.14.5)
set -euo pipefail

GUM_VERSION="${1:-0.14.5}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/${GUM_VERSION}"
TMP_DIR=""

log() { printf '[fetch-gum] %s\n' "$*" >&2; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

cleanup() { [ -n "${TMP_DIR}" ] && rm -rf -- "${TMP_DIR}"; }
trap cleanup EXIT

host_arch="$(uname -m)"
case "${host_arch}" in
  x86_64) HOST_ARCH="x86_64" ;;
  aarch64|arm64) HOST_ARCH="arm64" ;;
  *) fail "unsupported host architecture: ${host_arch}" ;;
esac
log "host arch: ${HOST_ARCH}; vendoring targets: x86_64 arm64"

command -v tar >/dev/null 2>&1 || fail "tar is required"
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  fail "curl or wget is required"
fi

mkdir -p -- "${DEST_DIR}"

for ARCH in x86_64 arm64; do
  BIN_PATH="${DEST_DIR}/gum-linux-${ARCH}"
  if [ -x "${BIN_PATH}" ]; then
    log "skip ${ARCH}: ${BIN_PATH} already present"
    continue
  fi

  URL="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/gum_${GUM_VERSION}_Linux_${ARCH}.tar.gz"
  log "downloading ${URL}"
  TMP_DIR="$(mktemp -d)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "${TMP_DIR}/gum.tar.gz" "${URL}" \
      || fail "download failed for ${ARCH}: ${URL}"
  else
    wget -q --tries=3 -O "${TMP_DIR}/gum.tar.gz" "${URL}" \
      || fail "download failed for ${ARCH}: ${URL}"
  fi

  ARCHIVE_MEMBER="gum_${GUM_VERSION}_Linux_${ARCH}/gum"
  tar -xzf "${TMP_DIR}/gum.tar.gz" -C "${TMP_DIR}" "${ARCHIVE_MEMBER}" \
    || fail "extraction failed (no '${ARCHIVE_MEMBER}' member) for ${ARCH}"

  mv -- "${TMP_DIR}/${ARCHIVE_MEMBER}" "${BIN_PATH}"
  chmod 0755 -- "${BIN_PATH}"
  rm -rf -- "${TMP_DIR}"
  TMP_DIR=""
  log "installed ${BIN_PATH}"
done

log "done (gum ${GUM_VERSION})"
