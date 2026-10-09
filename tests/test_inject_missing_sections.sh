#!/usr/bin/env bash
# A value written into a table config/cms.toml does not have must not vanish without a warning.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__inject_config.sh"
SAMPLE="${REPO_ROOT}/config/cms.toml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "${SANDBOX}/config"
cp "$SAMPLE" "${SANDBOX}/config/cms.toml"
[[ -f "${REPO_ROOT}/config/cms_ranking.toml" ]] \
  && cp "${REPO_ROOT}/config/cms_ranking.toml" "${SANDBOX}/config/"
printf 'RANKING_USERNAME=admin\nRANKING_PASSWORD=secret\n' > "${SANDBOX}/.env"

echo "run the real injector with a flag an operator would set"
if ! (cd "$SANDBOX" \
      && CAPTCHA_ENABLED=1 CAPTCHA_PROVIDER=recaptcha \
         CAPTCHA_SITE_KEY=site CAPTCHA_SECRET_KEY=secret \
         LOGIN_RATE_LIMIT_REDIS_ENABLED=1 \
         bash "$SCRIPT" >/dev/null 2>&1); then
  no "the injector ran to completion"
  printf '\n%d passed, %d failed\n' "$pass" "$fail"
  exit 1
fi
ok "the injector ran to completion"

INJECTED="${SANDBOX}/config/cms.toml"

echo "the captcha table exists for both web servers"
for section in admin_web_server contest_web_server; do
  if grep -q "^\[${section}\.captcha\]" "$INJECTED"; then
    ok "[${section}.captcha] is present"
  else
    no "[${section}.captcha] is present"
  fi
done

echo "the values landed inside the table, not merely the header"
if grep -A6 '^\[admin_web_server\.captcha\]' "$INJECTED" | grep -q '^enabled = true'; then
  ok "CAPTCHA_ENABLED=1 reached admin_web_server.captcha"
else
  no "CAPTCHA_ENABLED=1 reached admin_web_server.captcha"
fi

if grep -A6 '^\[contest_web_server\.captcha\]' "$INJECTED" | grep -q '^redis_enabled = true'; then
  ok "LOGIN_RATE_LIMIT_REDIS_ENABLED=1 reached contest_web_server.captcha"
else
  no "LOGIN_RATE_LIMIT_REDIS_ENABLED=1 reached contest_web_server.captcha"
fi

echo "creating a table never duplicated one that already existed"
for section in contest_web_server admin_web_server; do
  count="$(grep -c "^\[${section}\]$" "$INJECTED" || true)"
  if [[ "$count" -eq 1 ]]; then
    ok "[${section}] appears exactly once"
  else
    no "[${section}] appears exactly once (found $count)"
  fi
done

echo "a key that already exists is updated, not appended"
# num_proxies_used lives in two sections by design, so the count is taken inside one.
count="$(awk '/^\[contest_web_server\]$/{inside=1; next} /^\[/{inside=0} inside && /^num_proxies_used = /{n++} END{print n+0}' "$INJECTED")"
if [[ "$count" -eq 1 ]]; then
  ok "num_proxies_used is written once in [contest_web_server]"
else
  no "num_proxies_used is written once in [contest_web_server] (found $count)"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
