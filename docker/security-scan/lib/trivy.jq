# trivy.jq — `trivy rootfs --format json` → the feed's findings[].
#
# Only Results with Class "os-pkgs" are read: the scan runs with `--pkg-types os`, so an
# entry of another class would mean the flags changed, and silently relabelling it as an OS
# package would put the wrong kind in front of the operator.
#
# key = CVE|package|installed version. The route dedupes on (source, key) and never deletes,
# so the key must stay identical across runs and must change when the installed version does
# (a fixed package becomes a new row; the old one is resolved by the ingest call).
[
  .Results[]?
  | select(.Class == "os-pkgs")
  | . as $result
  | (.Vulnerabilities // [])[]
  | {
      key: (((.VulnerabilityID // "unknown") + "|" + (.PkgName // "unknown") + "|" + (.InstalledVersion // "")) | .[0:200]),
      kind: "os-package",
      severity: ((.Severity // "UNKNOWN") | ascii_upcase),
      subject: (.PkgName // "unknown"),
      installed: (.InstalledVersion // null),
      available: (if (.FixedVersion // "") == "" then null else .FixedVersion end),
      title: ((.Title // "") | .[0:200] | if . == "" then null else . end),
      url: (.PrimaryURL // null),
      detail: {
        target: $result.Target,
        os_family: $result.Type,
        vulnerability: .VulnerabilityID,
        pkg_id: .PkgID,
        fixed_version: (.FixedVersion // null)
      }
    }
]
