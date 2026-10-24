# osv.jq — `osv-scanner scan source --format json` → the feed's findings[].
#
# One row per (vulnerability, package) pair, not per advisory: the panel's question is "which
# of my dependencies is vulnerable", and the same GHSA in two lockfiles is two rows the
# operator fixes in two places.
#
# key = advisory id|package|installed version — same stability rule as trivy.jq.
def severity_bucket:
    ((. // "") | ascii_upcase) as $s
    | if $s == "MODERATE" then "MEDIUM"          # GHSA/NVD word for MEDIUM
      elif $s == "IMPORTANT" then "HIGH"         # Debian word for HIGH
      elif $s == "CRITICAL" or $s == "HIGH" or $s == "MEDIUM" or $s == "LOW" then $s
      else "UNKNOWN" end;

[
  .results[]?
  | .source.path as $path
  | .packages[]?
  | select((.vulnerabilities // []) | length > 0)
  | .package as $pkg
  | .vulnerabilities[]
  | {
      key: (((.id // "unknown") + "|" + ($pkg.name // "unknown") + "|" + ($pkg.version // "")) | .[0:200]),
      kind: "dependency",
      severity: (.database_specific.severity | severity_bucket),
      subject: ($pkg.name // "unknown"),
      installed: ($pkg.version // null),
      # The first fixed version any affected range names is the version that clears the row.
      available: ([.affected[]? | .ranges[]? | .events[]? | .fixed? | select(. != null)] | first // null),
      title: ((.summary // "") | .[0:200] | if . == "" then null else . end),
      url: (if (.id // "") == "" then null else "https://osv.dev/vulnerability/" + .id end),
      detail: {
        id: .id,
        ecosystem: $pkg.ecosystem,
        purl: $pkg.purl,
        source_path: $path,
        aliases: (.aliases // []),
        cvss: ([.severity[]? | .score] // [])
      }
    }
]
