# security-scan — one image for every findings producer of the CMS security feed.
#
# WHY an image of our own instead of three `docker run` invocations: the feed contract
# (docs/SECURITY-FEED.md) accepts exactly one payload shape, and three call sites is three
# places for that shape to drift. trivy and osv-scanner are static Go binaries, so they are
# copied out of their pinned upstream images rather than curled from release tarballs whose
# URLs rot. Renovate's docker manager bumps the three tags below — and, since the pinned-digest
# pass, the three @sha256 digests with them (docs/decisions/image-digest-pinning.md).
#
# Not in this image on purpose: the Diun container itself. It stays upstream
# (crazymax/diun) and posts to the translator this image serves in `diun-bridge` mode.

FROM ghcr.io/aquasecurity/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c AS trivy
FROM ghcr.io/google/osv-scanner:v2.7.0@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0 AS osv

FROM alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f

COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=osv /osv-scanner /usr/local/bin/osv-scanner

# curl + jq ARE the POST path (lib/feed.sh builds the envelope with jq and sends it with
# curl). busybox-extras supplies httpd, which serves the Diun translator as a CGI; the base
# busybox applet set does not include it. ca-certificates is what lets trivy reach ghcr.io
# for the vulnerability database and osv-scanner reach api.osv.dev.
RUN apk add --no-cache busybox-extras ca-certificates curl jq tzdata

COPY scan.sh /usr/local/bin/security-scan
COPY lib/feed.sh lib/osv.jq lib/trivy.jq lib/diun.jq /usr/local/lib/security-feed/
# The CGI has to live under <httpd root>/cgi-bin to be executable by busybox httpd, so it
# is a copy rather than a symlink: httpd resolves the path itself.
COPY lib/diun-cgi.sh /usr/local/lib/security-feed/www/cgi-bin/diun
RUN chmod 0755 /usr/local/bin/security-scan /usr/local/lib/security-feed/www/cgi-bin/diun \
    && printf 'ok\n' > /usr/local/lib/security-feed/www/healthz

ENV SECURITY_SCAN_LIB=/usr/local/lib/security-feed \
    TRIVY_CACHE_DIR=/var/cache/security-scan/trivy

ENTRYPOINT ["/usr/local/bin/security-scan"]
CMD ["help"]
