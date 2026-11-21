#!/bin/sh
# The one definition of the SSE proxy settings shared by every renderer that fronts the panel.
#
# WHY one file and not a copy per config: the panel's streams stay quiet far longer than an
# ordinary request, and three proxies can front the panel — each builds its own config, so a
# copy of these values would drift the moment one of them is tuned.
# WHY these values: a stream with no byte from upstream for proxy_read_timeout is closed, and a
# proxy that buffers would hold frames until it had a buffer full — both read by the panel as a
# dead connection. Only the SSE location inherits them; ordinary requests keep the default.

SSE_PROXY_READ_TIMEOUT="${SSE_PROXY_READ_TIMEOUT:-3600s}"

# Indented so a caller drops the pair into a location unchanged.
SSE_PROXY_DIRECTIVES="        proxy_read_timeout ${SSE_PROXY_READ_TIMEOUT};
        proxy_buffering off;"

# The panel endpoints that stay quiet between frames. A caller prepends its route prefix: the
# vhost root, or "/admin" where the panel answers on a sub-path.
SSE_ENDPOINT_PATTERN='api/((notifications|resources|containers)/stream$|deploy/status/)'
