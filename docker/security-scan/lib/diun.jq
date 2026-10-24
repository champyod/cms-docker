# diun.jq — Diun's webhook body → the feed's findings[].
#
# THE ONLY place Diun's shape (status/provider/image/digest/created/platform/metadata) is
# read. Nothing downstream of this file knows what Diun's payload looks like; the panel sees
# contract fields only.
#
# Diun notifies one image per POST, so this always yields exactly one finding, and the caller
# sends it with complete:false — see lib/diun-cgi.sh.
#
# key = image|platform: stable for as long as the same image is watched on the same platform,
# which is what makes repeated notifications update last_seen instead of piling up rows.
[
  {
    key: (((.image // "unknown") + "|" + (.platform // "unknown")) | .[0:200]),
    kind: "image",
    severity: null,                       # Diun reports staleness, not severity
    subject: (.image // "unknown"),
    installed: null,                      # Diun's body carries no previous digest — see below
    available: (.digest // null),
    title: (if (.status // "") == "new" then "image digest is new on this host"
            elif (.status // "") == "update" then "image digest changed in the registry"
            else "diun status: " + (.status // "unknown") end),
    url: null,
    detail: {
      status: .status,
      provider: .provider,
      platform: .platform,
      created: .created,
      digest: .digest,
      metadata: (.metadata // {})
    }
  }
]
