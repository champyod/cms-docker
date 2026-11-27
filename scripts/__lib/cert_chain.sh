#!/usr/bin/env bash
# scripts/__lib/cert_chain.sh — one definition of what a served TLS chain may contain.
#
# A fullchain.pem that repeats a CA certificate makes every TLS handshake carry the same
# bytes twice. Browsers tolerate it, so nothing breaks visibly; the certificate is still
# valid, which is exactly why it survived a renewal and reached the wire. Chain depth is
# fixed by the CA, so the correct file is the leaf plus each issuer once, in order — and
# that has to be enforced where the chain is written rather than noticed on the wire later.
#
# Leaf order is preserved deliberately: the first certificate is the one a server sends
# for its own name, so reordering would break the handshake even though every certificate
# is still present. Only repeats are dropped.

# Prints the certificate blocks of a PEM file, one block per line (newlines escaped), so a
# caller can compare blocks without a temporary file and without the base64 being touched.
_cert_chain_blocks() {
  awk '
    /-----BEGIN CERTIFICATE-----/ { buf = $0; inblock = 1; next }
    inblock { buf = buf "\n" $0 }
    /-----END CERTIFICATE-----/ { if (inblock) print buf; buf = ""; inblock = 0 }
  ' "$1"
}

# Normalises a PEM chain in place: the first certificate keeps its position, and every
# later certificate is kept only the first time it appears.
#
# Prints nothing and returns 0 when the file already holds a clean chain, so a caller can
# treat "unchanged" as success. Returns 1 when the file holds no certificate at all, which
# is a real failure rather than a clean chain.
cert_chain_normalise() {
  local file="$1" leaf rest
  [[ -f "$file" ]] || return 1

  # The leaf is whatever comes first; each later block is compared against the ones kept.
  leaf="$(awk '
    /-----BEGIN CERTIFICATE-----/ { buf = $0; inblock = 1; next }
    inblock { buf = buf "\n" $0 }
    /-----END CERTIFICATE-----/ { if (inblock) { print buf; exit } }
  ' "$file")"
  [[ -n "$leaf" ]] || return 1

  rest="$(awk -v leaf="$leaf" '
    function emit(b) { print b }
    /-----BEGIN CERTIFICATE-----/ { buf = $0; inblock = 1; next }
    inblock { buf = buf "\n" $0 }
    /-----END CERTIFICATE-----/ {
      if (!inblock) next
      inblock = 0
      # Drop the first block (the leaf, already accounted for) and any repeat.
      if (buf == leaf) { leafseen = 1; next }
      if (buf in seen) next
      seen[buf] = 1
      emit(buf)
    }
  ' "$file")"

  {
    printf '%s\n' "$leaf"
    [[ -n "$rest" ]] && printf '%s\n' "$rest"
  } > "${file}.chain.tmp"

  # Only replace when the content actually changed, so a normal renew leaves the mtime
  # alone and nothing downstream decides a certificate was reissued.
  if cmp -s "${file}.chain.tmp" "$file"; then
    rm -f "${file}.chain.tmp"
    return 0
  fi
  mv -f "${file}.chain.tmp" "$file"
  return 0
}

# Number of certificates in a PEM file. Used by the tests to state the property directly.
cert_chain_count() {
  [[ -f "$1" ]] || { printf '0'; return 1; }
  grep -c -- '-----BEGIN CERTIFICATE-----' "$1" 2>/dev/null || printf '0'
}
