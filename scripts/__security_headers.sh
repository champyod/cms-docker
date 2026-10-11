#!/usr/bin/env bash
# scripts/__security_headers.sh — build the front door's response hardening.
#
# Sourced, never executed, immediately before the envsubst pipeline (like
# __domain_routes.sh). Every value is a variable an operator sets in config.toml;
# the defaults hold a working deployment, not a fixed policy, so compatibility is
# tuned by editing a list — never the template.

SERVER_TOKENS_OFF="${SERVER_TOKENS_OFF:-1}"
OCSP_STAPLING="${OCSP_STAPLING:-1}"

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
  if [[ "${OCSP_STAPLING}" == "1" ]]; then
    OCSP_STAPLING_DIRECTIVES="ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/letsencrypt/live/${CERT_LINEAGE_DOMAIN}/chain.pem;"
  else
    OCSP_STAPLING_DIRECTIVES="# OCSP stapling disabled (OCSP_STAPLING=0)"
  fi

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

  export SERVER_TOKENS_DIRECTIVE OCSP_STAPLING_DIRECTIVES CSP_HEADER HSTS_HEADER LOCATION_SECURITY_HEADERS
}
