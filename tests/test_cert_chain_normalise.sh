#!/usr/bin/env bash
# A served TLS chain carries the leaf and each issuer once.
#
# The live chain sent seven certificates: the leaf, then the same three CA certificates
# twice, because the installed fullchain.pem was lego's .crt (leaf + three CAs) with its
# issuer.crt (the same three) appended. Nothing breaks visibly — the certificate verifies
# either way — so the defect survives renewals and reaches every handshake.
#
# These cases drive the normaliser that stands in front of every place the chain is
# written, using real certificates so block comparison runs on real base64.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=../scripts/__lib/cert_chain.sh
source "${REPO_ROOT}/scripts/__lib/cert_chain.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A CA, a leaf it signed, and a second CA, so repeats and distinct issuers are both real.
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=WS26 Test CA" \
  -keyout "$work/ca.key" -out "$work/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=ws26.example.org" \
  -keyout "$work/leaf.key" -out "$work/leaf.csr" 2>/dev/null
openssl x509 -req -in "$work/leaf.csr" -CA "$work/ca.pem" -CAkey "$work/ca.key" \
  -CAcreateserial -days 30 -out "$work/leaf.pem" 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=WS26 Other CA" \
  -keyout "$work/other.key" -out "$work/other.pem" 2>/dev/null

leaf="$work/leaf.pem"; ca="$work/ca.pem"; other="$work/other.pem"

echo "a clean chain is left alone"
cat "$leaf" "$ca" > "$work/clean.pem"
before="$(sha256sum "$work/clean.pem" | cut -d' ' -f1)"
cert_chain_normalise "$work/clean.pem" \
  && ok "a clean chain is accepted" \
  || no "a clean chain is accepted"
if [[ "$(cert_chain_count "$work/clean.pem")" == "2" ]] \
   && [[ "$(sha256sum "$work/clean.pem" | cut -d' ' -f1)" == "$before" ]]; then
  ok "a clean chain keeps both certificates and its bytes"
else
  no "a clean chain keeps both certificates and its bytes"
fi

echo "a repeated issuer is dropped"
cat "$leaf" "$ca" "$ca" > "$work/dup.pem"
cert_chain_normalise "$work/dup.pem"
if [[ "$(cert_chain_count "$work/dup.pem")" == "2" ]]; then
  ok "the repeated issuer is gone (2 certificates)"
else
  no "the repeated issuer is gone (got $(cert_chain_count "$work/dup.pem"))"
fi

echo "the live shape collapses to one of each"
# Leaf plus the same two issuers twice: what the host served as leaf + 3 CAs twice.
cat "$leaf" "$ca" "$other" "$ca" "$other" > "$work/live-shape.pem"
cert_chain_normalise "$work/live-shape.pem"
if [[ "$(cert_chain_count "$work/live-shape.pem")" == "3" ]]; then
  ok "leaf plus two distinct issuers, each once (3 certificates)"
else
  no "leaf plus two distinct issuers, each once (got $(cert_chain_count "$work/live-shape.pem"))"
fi
if [[ "$(head -2 "$work/live-shape.pem" | tail -1)" == "$(head -2 "$leaf" | tail -1)" ]]; then
  ok "the leaf is still the first certificate"
else
  no "the leaf is still the first certificate"
fi

echo "a chain with no repeats keeps every certificate"
cat "$leaf" "$other" "$ca" > "$work/order.pem"
cert_chain_normalise "$work/order.pem"
if [[ "$(cert_chain_count "$work/order.pem")" == "3" ]]; then
  ok "a chain with no repeats keeps all three"
else
  no "a chain with no repeats keeps all three (got $(cert_chain_count "$work/order.pem"))"
fi

echo "a repeated leaf is dropped but the first stays first"
cat "$leaf" "$other" "$leaf" > "$work/leaf-repeat.pem"
cert_chain_normalise "$work/leaf-repeat.pem"
if [[ "$(cert_chain_count "$work/leaf-repeat.pem")" == "2" ]] \
   && [[ "$(head -2 "$work/leaf-repeat.pem" | tail -1)" == "$(head -2 "$leaf" | tail -1)" ]]; then
  ok "the repeated leaf is gone, the original stays first"
else
  no "the repeated leaf is gone, the original stays first (got $(cert_chain_count "$work/leaf-repeat.pem"))"
fi

echo "a file with no certificate is refused"
printf 'not a certificate\n' > "$work/junk.pem"
cert_chain_normalise "$work/junk.pem" \
  && no "a file with no certificate is refused" \
  || ok "a file with no certificate is refused"

echo "a normalised chain still verifies against its CA"
cat "$leaf" "$ca" "$ca" > "$work/verify.pem"
cert_chain_normalise "$work/verify.pem"
if openssl verify -CAfile "$ca" -untrusted "$work/verify.pem" "$leaf" >/dev/null 2>&1; then
  ok "the normalised chain verifies"
else
  no "the normalised chain verifies"
fi

echo "the install path normalises what lego wrote"
# The install copies lego's .crt to fullchain.pem. This drives that copy plus the
# normaliser the way acme_install_lego_cert does, proving the fix is wired at the
# install rather than only available as a function.
cat "$leaf" "$ca" "$ca" > "$work/lego.crt"
mkdir -p "$work/live/ws26.example.org"
cp -f "$work/lego.crt" "$work/live/ws26.example.org/fullchain.pem"
cert_chain_normalise "$work/live/ws26.example.org/fullchain.pem"
if [[ "$(cert_chain_count "$work/live/ws26.example.org/fullchain.pem")" == "2" ]]; then
  ok "the installed fullchain carries the leaf and one issuer"
else
  no "the installed fullchain carries the leaf and one issuer (got $(cert_chain_count "$work/live/ws26.example.org/fullchain.pem"))"
fi
if openssl verify -CAfile "$ca" "$work/live/ws26.example.org/fullchain.pem" >/dev/null 2>&1; then
  ok "the installed fullchain still verifies"
else
  no "the installed fullchain still verifies"
fi

echo "the writers are wired to the normaliser"
for writer in scripts/__acme_tls_alpn.sh scripts/__domain.sh; do
  if grep -q 'cert_chain_normalise' "$REPO_ROOT/$writer"; then
    ok "$writer normalises the chain it installs"
  else
    no "$writer normalises the chain it installs"
  fi
done
if grep -q '__lib/cert_chain.sh' "$REPO_ROOT/scripts/__domain.sh"; then
  ok "the shared definition is sourced once, by the entry script"
else
  no "the shared definition is sourced once, by the entry script"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
