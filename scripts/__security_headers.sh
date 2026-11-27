#!/usr/bin/env bash
# scripts/__security_headers.sh — build the front door's response hardening.
#
# Sourced, never executed, immediately before the envsubst pipeline (like
# __domain_routes.sh). Every value is a variable an operator sets in config.toml;
# the defaults hold a working deployment, not a fixed policy, so compatibility is
# tuned by editing a list — never the template.

SERVER_TOKENS_OFF="${SERVER_TOKENS_OFF:-1}"
OCSP_STAPLING="${OCSP_STAPLING:-1}"

# The certificate the vhost will serve. Defaults to the path the template names, so the
# builder works when sourced on its own; __domain.sh exports the store it actually uses.
# CERT_DIR_NAME may be absolute (a relocated store), so it is not always joined to the repo.
_ocsp_default_cert_path() {
  local dir="${CERT_DIR_NAME:-letsencrypt}"
  [[ "$dir" == /* ]] || dir="${REPO_ROOT:-}/config/${dir}"
  printf '%s/live/%s/fullchain.pem' "$dir" "${CERT_LINEAGE_DOMAIN:-}"
}
OCSP_CERT_PATH="${OCSP_CERT_PATH:-$(_ocsp_default_cert_path)}"

# Whether the leaf names an OCSP responder.
#
# WHY this decides the directives rather than a fixed choice: nginx can only staple a
# response it can fetch, and it fetches from the URL in the certificate's AIA extension
# (src/event/ngx_event_openssl_stapling.c:463-469 logs "no OCSP responder URL in the
# certificate" and declines). Let's Encrypt removed that URL on 2025-05-07 and turned its
# responders off on 2025-08-06, publishing revocation through CRLs, so emitting stapling
# unconditionally ships a control that cannot fire — and a test asserting the directive
# text then reports protection that does not exist.
#
# A certificate that cannot be read is treated the same as one with no URL: stapling would
# gain nothing and guessing "on" is what produced the false assurance.
_ocsp_certificate_staplable() {
  local cert="$1" uri
  [[ -f "$cert" ]] || return 1
  command -v openssl >/dev/null 2>&1 || return 1
  uri="$(openssl x509 -in "$cert" -noout -ocsp_uri 2>/dev/null)" || return 1
  [[ -n "$uri" ]]
}

# CSP is off by default so enabling it is a deliberate, tested step. Each *_SRC is
# a space-separated source list; an empty list omits the directive entirely.
CSP_ENABLED="${CSP_ENABLED:-0}"
CSP_MODE="${CSP_MODE:-report-only}"
CSP_REPORT_URI="${CSP_REPORT_URI:-}"
# Each list uses `${VAR-default}`, not `${VAR:-default}`: an operator drops a directive
# by setting the list empty, and `:-` would treat that empty as unset and restore the
# default. An unset variable still gets the default.
CSP_DEFAULT_SRC="${CSP_DEFAULT_SRC-'self'}"
CSP_SCRIPT_SRC="${CSP_SCRIPT_SRC-'self'}"
CSP_STYLE_SRC="${CSP_STYLE_SRC-'self' 'unsafe-inline'}"
CSP_IMG_SRC="${CSP_IMG_SRC-'self' data:}"
CSP_FONT_SRC="${CSP_FONT_SRC-'self'}"
CSP_CONNECT_SRC="${CSP_CONNECT_SRC-'self'}"
CSP_OBJECT_SRC="${CSP_OBJECT_SRC-'none'}"
CSP_BASE_URI="${CSP_BASE_URI-'self'}"
CSP_FORM_ACTION="${CSP_FORM_ACTION-'self'}"
CSP_FRAME_ANCESTORS="${CSP_FRAME_ANCESTORS-'self'}"

_security_csp_policy() {
  local pair name value policy=""
  for pair in \
    "default-src:${CSP_DEFAULT_SRC}" \
    "script-src:${CSP_SCRIPT_SRC}" \
    "style-src:${CSP_STYLE_SRC}" \
    "img-src:${CSP_IMG_SRC}" \
    "font-src:${CSP_FONT_SRC}" \
    "connect-src:${CSP_CONNECT_SRC}" \
    "object-src:${CSP_OBJECT_SRC}" \
    "base-uri:${CSP_BASE_URI}" \
    "form-action:${CSP_FORM_ACTION}" \
    "frame-ancestors:${CSP_FRAME_ANCESTORS}"; do
    name="${pair%%:*}"
    value="${pair#*:}"
    [[ -n "$value" ]] || continue
    policy+="${policy:+; }${name} ${value}"
  done
  [[ -z "$CSP_REPORT_URI" ]] || policy+="${policy:+; }report-uri ${CSP_REPORT_URI}"
  printf '%s' "$policy"
}

_security_headers_build() {
  local csp_name
  if [[ "${SERVER_TOKENS_OFF}" == "1" ]]; then
    SERVER_TOKENS_DIRECTIVE="server_tokens off;"
  else
    SERVER_TOKENS_DIRECTIVE="# server_tokens left on (SERVER_TOKENS_OFF=0)"
  fi

  # ssl_stapling reuses the http-level resolver the route targets already declare,
  # so no second resolver line (and no duplicate-directive conflict) is emitted.
  #
  # The directives are emitted only when the certificate can actually be stapled, so the
  # rendered file never claims a control this CA cannot satisfy. The note is what an
  # operator sees instead, and is empty when nothing needed saying.
  OCSP_STAPLING_NOTE=""
  if [[ "${OCSP_STAPLING}" != "1" ]]; then
    OCSP_STAPLING_DIRECTIVES="# OCSP stapling disabled (OCSP_STAPLING=0)"
  elif _ocsp_certificate_staplable "${OCSP_CERT_PATH}"; then
    OCSP_STAPLING_DIRECTIVES="ssl_stapling on;
ssl_stapling_verify on;"
    OCSP_STAPLING_ANCHOR="ssl_trusted_certificate /etc/letsencrypt/live/${CERT_LINEAGE_DOMAIN}/fullchain.pem;"
  else
    OCSP_STAPLING_DIRECTIVES="# OCSP stapling off: the certificate names no OCSP responder (OCSP_STAPLING=1)"
    if [[ -f "${OCSP_CERT_PATH}" ]]; then
      OCSP_STAPLING_NOTE="OCSP stapling off: ${CERT_LINEAGE_DOMAIN} carries no OCSP responder URL, so nginx has nothing to staple; revocation for this certificate is published through Certificate Revocation List distribution points"
    else
      OCSP_STAPLING_NOTE="OCSP stapling off: ${OCSP_CERT_PATH} cannot be read, so stapling is not claimed; revocation is not checked from this file"
    fi
  fi
  # The anchor is a directive of its own, not part of stapling: it belongs with the chain
  # regardless, and an empty value is dropped from the template rather than left blank.
  [[ -n "${OCSP_STAPLING_ANCHOR:-}" ]] || OCSP_STAPLING_ANCHOR="# OCSP trust anchor not emitted (stapling is off)"

  if [[ "${CSP_ENABLED}" == "1" ]]; then
    if [[ "${CSP_MODE}" == "enforce" ]]; then
      csp_name="Content-Security-Policy"
    else
      csp_name="Content-Security-Policy-Report-Only"
    fi
    CSP_HEADER="add_header ${csp_name} \"$(_security_csp_policy)\" always;"
  else
    CSP_HEADER="# Content-Security-Policy disabled (CSP_ENABLED=0)"
  fi

  HSTS_HEADER="add_header Strict-Transport-Security \"max-age=${HSTS_MAX_AGE}; includeSubDomains\" always;"
  # A location that declares any add_header drops every server-level one, so the
  # static-asset location re-declares HSTS and CSP alongside its Cache-Control.
  LOCATION_SECURITY_HEADERS="${HSTS_HEADER}
${CSP_HEADER}"

  export SERVER_TOKENS_DIRECTIVE OCSP_STAPLING_DIRECTIVES OCSP_STAPLING_ANCHOR OCSP_STAPLING_NOTE CSP_HEADER HSTS_HEADER LOCATION_SECURITY_HEADERS
}
