# zap.jq — a ZAP baseline JSON report (`zap-baseline.py -J`) → the feed's findings[].
#
# THE ONLY place ZAP's shape (site[] / alerts[] / pluginid / riskdesc / instances[]) is read.
# Nothing downstream knows what a ZAP report looks like; the panel sees contract fields only.
#
# One row per (alert, URL), not per alert: the same missing header on /login and /admin is two
# pages the operator fixes in two places, and a waiver matches a finding key, not a rule.
#
# key = pluginid|normalised url — stable across runs, which is what makes a rescan update
# last_seen on the row it already wrote instead of piling up a new one every night.

# WHY the URL loses its query string, fragment and trailing slash: ZAP reports the exact URL an
# alert was seen on, and a query string that varies per run would mint a new finding per scan.
# Only scheme and host are lowercased — a path may be case-sensitive on the server.
def norm_url:
    (. // "")
    | sub("#.*$"; "")
    | sub("\\?.*$"; "")
    | sub("^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*)://(?<rest>[^/]*)";
          "\(.scheme | ascii_downcase)://\(.rest | ascii_downcase)")
    | if . == "" then . else sub("/+$"; "") end;

# ZAP words the risk in `riskdesc` ("Medium (Medium)"); `riskcode` is the number behind it and is
# the fallback for a report that carries no description.
def risk_word:
    (.riskcode // "" | tostring) as $code
    | ((.riskdesc // "") | sub("\\s*\\(.*$"; "") | ascii_upcase) as $word
    | if $word != "" then $word
      else ({"3": "HIGH", "2": "MEDIUM", "1": "LOW", "0": "INFORMATIONAL"}[$code] // "")
      end;

# The contract's five words and nothing else: Informational is a hardening note, not a hole, so it
# lands as LOW. A word this mapper does not know becomes UNKNOWN — never dropped, never promoted.
def severity_bucket:
    ascii_upcase
    | if . == "CRITICAL" or . == "HIGH" or . == "MEDIUM" or . == "LOW" then .
      elif . == "INFORMATIONAL" or . == "INFO" then "LOW"
      else "UNKNOWN" end;

[
  .site[]? as $site
  | ($site.host // $site["@host"] // "") as $host
  | ($site["@name"] // "") as $site_url
  | ($site.alerts // [])[] as $alert
  # An alert without instances was seen on the site itself; one row is still owed for it.
  | (($alert.instances // []) | if length > 0 then . else [{uri: $site_url}] end)[] as $instance
  | (($instance.uri // $site_url) | norm_url) as $url
  | (($alert.pluginid // $alert.alertRef // "unknown") | tostring) as $plugin
  # WHY the host stands in when the URL normalises to nothing: a key may not be empty, and the
  # site is still the thing that is affected.
  | (if $url == "" then $host else $url end) as $where
  | {
      key: (($plugin + "|" + $where) | .[0:200]),
      kind: "web",
      severity: ($alert | risk_word | severity_bucket),
      subject: ($where | .[0:200]),
      installed: null,          # a header rule has no version to be behind
      available: null,          # and no version that fixes it
      title: (($alert.alert // $alert.name // "") | .[0:200] | if . == "" then null else . end),
      url: ("https://www.zaproxy.org/docs/alerts/" + $plugin + "/"),
      host: (if $host == "" then null else $host end),
      detail: {
        pluginid: $plugin,
        alert_ref: $alert.alertRef,
        risk: ($alert | risk_word),
        confidence: ($alert.confidencedesc // $alert.confidence),
        cweid: $alert.cweid,
        wascid: $alert.wascid,
        method: $instance.method,
        uri: $instance.uri,
        evidence: (($instance.evidence // $instance.attack // "") | .[0:400]),
        count: $alert.count,
        solution: (($alert.solution // "") | .[0:600])
      }
    }
]
# Two instances that normalise to one URL are one row: the panel keys on (source, key), and a
# duplicate inside a single body would be a race, not two findings.
| unique_by(.key)
