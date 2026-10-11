#!/usr/bin/env bash
# scripts/__domain_routes.sh — build the grader nginx route and upstream blocks.
#
# Sourced, never executed. Sourced immediately before the envsubst pipeline so the
# per-route directive sets can be folded from RANKING_AUTH_DIRECTIVES and
# PER_USER_RANKING_DIRECTIVES, which the render function finalises immediately before.
#
# WHY generated blocks rather than template literals: envsubst expands one variable
# to one string and cannot repeat it, so per-service blocks written in the template
# would need one hand-made copy per service per vhost, and each copy would carry its
# own copy of the directives that service needs. The rows below are the only place a
# service is described; the template holds no upstream, no path prefix and no
# service name.
#
# Nothing in this file is a literal service, path or domain. The table names
# variables, and every value — including each default — is a variable an operator
# overrides. A default holds the deployment in use today only so that changing
# nothing keeps every existing link working.
#
# Placement. Every row is mounted twice: once at the root of the vhost its domain_var
# names, and once on the primary vhost at its path_var. So a service is reachable both
# on a vhost of its own and as a sub-path of the contest site. The first row to name a
# domain claims that vhost root; a later row naming the same domain is a sub-route of
# it, which is how a second service joins a vhost. A row whose path_var is empty is
# mounted on no sub-path at all, which is how a service is taken off the primary vhost
# without editing the table.

# label|domain_var|path_var|upstream_var|listen_port_var
_ROUTES_TABLE="$(cat <<'EOF'
primary|DOMAIN_NAME|CONTEST_ROUTE_PATH|CONTEST_UPSTREAM|CONTEST_LISTEN_PORT
admin|ADMIN_DOMAIN|ADMIN_ROUTE_PATH|ADMIN_UPSTREAM|ADMIN_NEXT_LISTEN_PORT
oj|OJ_DOMAIN|OJ_ROUTE_PATH|OJ_UPSTREAM|OJ_BACKEND_PORT
ranking|RANKING_DOMAIN|RANKING_ROUTE_PATH|RANKING_UPSTREAM|RANKING_LISTEN_PORT
admin_classic|ADMIN_DOMAIN|ADMIN_CLASSIC_ROUTE_PATH|ADMIN_CLASSIC_UPSTREAM|ADMIN_LISTEN_PORT
EOF
)"

CONTEST_ROUTE_PATH="${CONTEST_ROUTE_PATH:-/}"
ADMIN_ROUTE_PATH="${ADMIN_ROUTE_PATH:-/admin}"
ADMIN_CLASSIC_ROUTE_PATH="${ADMIN_CLASSIC_ROUTE_PATH:-/classic}"
RANKING_ROUTE_PATH="${RANKING_ROUTE_PATH:-/ranking}"
OJ_ROUTE_PATH="${OJ_ROUTE_PATH:-}"

CONTEST_UPSTREAM="${CONTEST_UPSTREAM:-cms-contest-web-server}"
ADMIN_UPSTREAM="${ADMIN_UPSTREAM:-cms-admin-panel-next}"
ADMIN_CLASSIC_UPSTREAM="${ADMIN_CLASSIC_UPSTREAM:-cms-admin-web-server}"
RANKING_UPSTREAM="${RANKING_UPSTREAM:-cms-ranking-web-server}"
OJ_UPSTREAM="${OJ_UPSTREAM:-host.docker.internal}"

# The Next.js panel answers on a fixed container port that compose maps from the
# host side; there was no variable for it, so the template carried the number.
ADMIN_NEXT_LISTEN_PORT="${ADMIN_NEXT_LISTEN_PORT:-3000}"

# The contest upstream balances connections rather than requests. Every other
# upstream has one server, where the choice changes nothing, so those default to
# empty and emit no balancing directive at all.
CONTEST_UPSTREAM_METHOD="${CONTEST_UPSTREAM_METHOD:-least_conn}"

# Re-resolution. The route targets are variables, not static upstream blocks, and this
# resolver answers them per request — so a recreated container is dialled again within
# valid=. Docker's embedded DNS answers at 127.0.0.11.
DOMAIN_ROUTE_RESOLVER="${DOMAIN_ROUTE_RESOLVER:-127.0.0.11}"
DOMAIN_ROUTE_RESOLVER_VALID="${DOMAIN_ROUTE_RESOLVER_VALID:-10s}"

CONTEST_ROUTE_DIRECTIVES="${CONTEST_ROUTE_DIRECTIVES:-}"
ADMIN_ROUTE_DIRECTIVES="${ADMIN_ROUTE_DIRECTIVES:-}"
ADMIN_CLASSIC_ROUTE_DIRECTIVES="${ADMIN_CLASSIC_ROUTE_DIRECTIVES:-}"
OJ_ROUTE_DIRECTIVES="${OJ_ROUTE_DIRECTIVES:-}"

# The ranking service carries the directive set every other route is the plain
# proxy of: it answers over WebSocket, streams instead of buffering, and is the
# only route rate-limited on a zone of its own. An operator that wants a bare
# proxy sets this to a comment line.
RANKING_ROUTE_LIMIT_ZONE="${RANKING_ROUTE_LIMIT_ZONE:-ranking_auth}"

# Folded at build time, not at source time: RANKING_AUTH_DIRECTIVES and
# PER_USER_RANKING_DIRECTIVES are set by the caller immediately before it invokes
# the build, so reading them any earlier would capture empty strings.
_routes_expand_default_directives() {
  RANKING_ROUTE_DIRECTIVES="${RANKING_ROUTE_DIRECTIVES:-$(cat <<EOF
${RANKING_AUTH_DIRECTIVES:-}
proxy_http_version 1.1;
proxy_set_header Upgrade \$http_upgrade;
proxy_set_header Connection "upgrade";
proxy_buffering off;
limit_req zone=${RANKING_ROUTE_LIMIT_ZONE} burst=10 nodelay;
${PER_USER_RANKING_DIRECTIVES:-}
EOF
)}"
}

ROUTE_LABEL=()
ROUTE_DOMAIN_VAR=()
ROUTE_PATH_VAR=()
ROUTE_UPSTREAM_VAR=()
ROUTE_PORT_VAR=()
ROUTE_PATH=()
ROUTE_OWNER=()
ROUTE_PRIMARY_DOMAIN_VAR=""

# Validates one *_ROUTE_PATH and normalises it into the variable named by $3. An
# empty value is not an error: it is how a route is taken off every vhost but its own.
#
# WHY fail rather than repair: a path that does not start at the root, or that
# carries an empty segment, renders a location nginx either rejects or matches
# somewhere the operator did not intend — and the second case is silent, shadowing
# the route that was meant to answer there.
#
# Assigns through the name in $3 rather than printing, because every renderer reads it
# through a command substitution, where a log_die would end the subshell and not the
# build.
_route_normalize_path() {
  local path_var="$1" value="$2" out_name="$3" vhost="$4" trimmed
  if [[ -z "$value" ]]; then printf -v "$out_name" '' ; return 0; fi
  [[ "$value" == /* ]] \
    || log_die "${path_var}='${value}' on the ${vhost} vhost must start with '/'" 1
  [[ "$value" != *'//'* ]] \
    || log_die "${path_var}='${value}' on the ${vhost} vhost has an empty path segment" 1
  trimmed="${value%/}"
  printf -v "$out_name" '%s' "${trimmed:-/}"
}

# The location matcher for a normalised path. A trailing slash on a prefix match
# makes nginx match the whole segment rather than any string starting with it, and
# the root is already its own segment, so it takes no second one.
_route_matcher() {
  local path="$1"
  [[ -n "$path" ]] || return 0
  if [[ "$path" == "/" ]]; then printf '/'; return 0; fi
  printf '%s/' "$path"
}

# A duplicate path inside one vhost is not an error nginx reports: the second block
# wins, and the service the first one served silently stops answering.
#
# Every row is mounted on the primary vhost at its path_var, so two rows sharing a
# path collide there whatever domains they name — which makes the primary vhost the
# place a duplicate can always be caught, once, before any text is produced.
_routes_assert_unused_path() {
  local vhost="$1" path="$2" path_var="$3" seen="$4"
  [[ -z "$path" ]] && return 0
  [[ " ${seen}" != *" ${path} "* ]] \
    || log_die "${path_var}='${path}' duplicates a route already on the ${vhost} vhost — nginx would shadow one of them" 1
}

# Reads the table into the ROUTE_* arrays, rejecting any path that could not render
# as the location it claims to be. The first row to name a domain owns that vhost's
# root; later rows on it are sub-routes, which is the only thing that distinguishes a
# second row sharing a domain from the first.
#
# WHY the whole check lives here: the renderers are command substitutions, and
# log_die ends only the subshell it runs in, so a failure raised there would be
# discarded and the shadowed or unparseable block emitted anyway. This function runs
# in the shell that drives the render, so a log_die here stops the build outright.
_routes_collect() {
  local label domain_var path_var upstream_var port_var
  local path upstream port claimed="" seen=""
  ROUTE_LABEL=() ROUTE_DOMAIN_VAR=() ROUTE_PATH_VAR=()
  ROUTE_UPSTREAM_VAR=() ROUTE_PORT_VAR=() ROUTE_OWNER=() ROUTE_PATH=()
  while IFS='|' read -r label domain_var path_var upstream_var port_var; do
    [[ -n "$label" ]] || continue
    upstream="${!upstream_var:-}"
    port="${!port_var:-}"
    # WHY the upstream check waits for the domain: a service nobody configured is not a
    # broken route, it is a route that is off. Its vhost is stripped and no block is
    # emitted, so demanding a target for it would stop a contest-only or ranking-only
    # deployment over a service nobody asked for. A service that IS configured and has no
    # upstream is a real misconfiguration — the block would emit `server :;` and nginx
    # would reject the whole file, taking the working vhosts down with it.
    if [[ -n "${!domain_var:-}" ]]; then
      [[ -n "$upstream" ]] || log_die "${upstream_var} is empty — the ${label} route is configured for domain ${!domain_var} but has no upstream target" 1
      [[ "$port" =~ ^[0-9]+$ ]] || log_die "${port_var}='${port}' is not a port number for the ${label} route" 1
    fi
    _route_normalize_path "$path_var" "${!path_var:-}" path "${ROUTE_LABEL[0]:-primary}"
    _routes_assert_unused_path "${ROUTE_LABEL[0]:-primary}" "$path" "$path_var" "$seen"
    seen="${seen} ${path}"
    ROUTE_LABEL+=("$label")
    ROUTE_DOMAIN_VAR+=("$domain_var")
    ROUTE_PATH_VAR+=("$path_var")
    ROUTE_UPSTREAM_VAR+=("$upstream_var")
    ROUTE_PORT_VAR+=("$port_var")
    ROUTE_PATH+=("$path")
    if [[ " ${claimed} " == *" ${domain_var} "* ]]; then
      ROUTE_OWNER+=(0)
    else
      claimed="${claimed} ${domain_var}"
      ROUTE_OWNER+=(1)
    fi
  done <<< "$_ROUTES_TABLE"
  ROUTE_PRIMARY_DOMAIN_VAR="${ROUTE_DOMAIN_VAR[0]}"
}

# The resolver the variable proxy targets are answered through, emitted once in the
# http context. ipv6=off keeps it to the A records Docker's embedded DNS returns.
_routes_resolver_block() {
  printf 'resolver %s valid=%s ipv6=off;\n' "$DOMAIN_ROUTE_RESOLVER" "$DOMAIN_ROUTE_RESOLVER_VALID"
}

# The proxy target variable a location sets and dials, derived from the row label so a
# row needs no second naming scheme.
_route_target_var() {
  printf '$cms_%s' "$1"
}

# The directive set is emitted before the proxy_pass so the two stay in the order
# the hand-written blocks had them; nginx orders directives inside a location by
# phase, not by where they appear.
_routes_location_block() {
  local index="$1" matcher="$2"
  local directives_var="${ROUTE_LABEL[$index]^^}_ROUTE_DIRECTIVES"
  local upstream_var="${ROUTE_UPSTREAM_VAR[$index]}"
  local port_var="${ROUTE_PORT_VAR[$index]}"
  local target_var
  target_var="$(_route_target_var "${ROUTE_LABEL[$index]}")"
  printf '    location %s {\n' "$matcher"
  [[ -z "${!directives_var:-}" ]] || printf '%s\n' "${!directives_var}"
  printf '        set %s %s:%s;\n' "$target_var" "${!upstream_var}" "${!port_var}"
  # A variable proxy_pass does not strip the location prefix the way a literal one
  # did, so a sub-path route rewrites it away to keep the target path unchanged.
  [[ "$matcher" == "/" ]] || printf '        rewrite ^%s(.*)$ /$1 break;\n' "$matcher"
  printf '        proxy_pass http://%s;\n' "$target_var"
  printf '        proxy_redirect off;\n'
  printf '    }\n'
}

# Renders every route a vhost serves: its own domain's rows, plus the whole table
# when this is the primary vhost.
#
# A row that owns a vhost answers that vhost's root whatever path_var says: the
# path names where the service also answers on the primary vhost, not where it
# lives on a vhost of its own. Everywhere else an empty path means the route is not
# served from this vhost and no block is emitted for it.
_routes_render_vhost() {
  local domain_var="$1" is_primary="$2"
  local index owner matcher blocks=""
  for index in "${!ROUTE_LABEL[@]}"; do
    owner=0
    if [[ "${ROUTE_DOMAIN_VAR[$index]}" == "$domain_var" ]]; then
      if (( ROUTE_OWNER[$index] )); then
        owner=1
      elif [[ -z "${ROUTE_PATH[$index]}" ]]; then
        continue
      fi
    elif [[ "$is_primary" == "1" && -n "${ROUTE_PATH[$index]}" ]]; then
      :
    else
      continue
    fi
    if (( owner )); then
      matcher='/'
    else
      matcher="$(_route_matcher "${ROUTE_PATH[$index]}")"
    fi
    blocks+="$(_routes_location_block "$index" "$matcher")"$'\n'
  done
  printf '%s' "$blocks"
}

_routes_render_upstreams() {
  _routes_resolver_block
}

# The domain variable a named vhost serves, taken from the table row that claims
# the vhost root. Only the four vhost names the template declares can be asked for;
# a name with no matching row falls back to the primary domain, which then renders
# no block because the region is stripped when that domain is unset.
_routes_domain_of() {
  local want="$1" index
  for index in "${!ROUTE_LABEL[@]}"; do
    if [[ "${ROUTE_LABEL[$index]}" == "$want" ]] && (( ROUTE_OWNER[$index] )); then
      printf '%s' "${ROUTE_DOMAIN_VAR[$index]}"
      return 0
    fi
  done
  printf '%s' "$ROUTE_PRIMARY_DOMAIN_VAR"
}

# The four vhosts the template declares. Each names the domain variable whose rows it
# serves; a name no row claims gets no location block at all, because the region is
# stripped before that ever matters.
_routes_build() {
  local resolver_block primary_upstream_var primary_port_var
  resolver_block="$(_routes_render_upstreams)"
  PRIMARY_ROUTE_BLOCKS="$(_routes_render_vhost "$ROUTE_PRIMARY_DOMAIN_VAR" 1)"
  ADMIN_ROUTE_BLOCKS="$(_routes_render_vhost "$(_routes_domain_of admin)" 0)"
  OJ_ROUTE_BLOCKS="$(_routes_render_vhost "$(_routes_domain_of oj)" 0)"
  RANKING_ROUTE_BLOCKS="$(_routes_render_vhost "$(_routes_domain_of ranking)" 0)"
  # The template's own proxy_pass sites dial the primary route, so the primary target is
  # exposed both as the variable to dial and as the server-level set that binds it.
  PRIMARY_UPSTREAM="$(_route_target_var "${ROUTE_LABEL[0]}")"
  primary_upstream_var="${ROUTE_UPSTREAM_VAR[0]}"
  primary_port_var="${ROUTE_PORT_VAR[0]}"
  PRIMARY_UPSTREAM_SET="set ${PRIMARY_UPSTREAM} ${!primary_upstream_var}:${!primary_port_var};"

  export ROUTE_RESOLVER="$resolver_block"
  export PRIMARY_ROUTE_BLOCKS ADMIN_ROUTE_BLOCKS OJ_ROUTE_BLOCKS RANKING_ROUTE_BLOCKS
  export PRIMARY_UPSTREAM PRIMARY_UPSTREAM_SET
}

# The single entrypoint the caller invokes. Split from sourcing so the directive
# sets it folds are the ones the render function had just computed.
_domain_routes_build() {
  _routes_expand_default_directives
  _routes_collect
  _routes_build
}
