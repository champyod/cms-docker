#!/usr/bin/env bash
# tests/test_seed_permissions_image.sh — the host fallback must run the seed inside the admin image.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "${SB}/bin" "${SB}/scripts/__lib"
cp "${REPO_ROOT}/scripts/__seed_permissions.sh" "${SB}/scripts/"
cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/"

cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  inspect) printf 'ghcr.io/champyod/cms-docker-admin-panel:test\n' ;;
  run)     printf '%s\n' "$*" > "$STUB_RUN"; printf 'seed-ok\n' ;;
  *)       : ;;
esac
exit 0
STUB
chmod +x "${SB}/bin/docker"

STUB_RUN="${SB}/run.txt"
PATH="${SB}/bin:${PATH}" STUB_RUN="$STUB_RUN" \
  bash "${SB}/scripts/__seed_permissions.sh" 'postgresql://owner:pw@127.0.0.1:5432/cmsdb' > "${SB}/out.log" 2>&1
rc=$?
[[ ${rc} -eq 0 ]] && ok "the image seed exits 0" || no "the image seed exited ${rc}"
grep -q 'seed-ok' "${SB}/out.log" && ok "the seed ran" || no "the seed did not run"
grep -q -- '--network host' "${STUB_RUN}" && ok "the seed uses host networking" || no "host networking missing"
grep -q -- 'DATABASE_URL=postgresql://owner:pw@127.0.0.1:5432/cmsdb' "${STUB_RUN}" \
  && ok "the owner URL is passed" || no "owner URL missing"
grep -q -- 'node_modules/.bin/tsx prisma/seed-permissions.ts' "${STUB_RUN}" \
  && ok "the image seed command is pinned" || no "seed command missing"

printf '\nseed-permissions-image: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
