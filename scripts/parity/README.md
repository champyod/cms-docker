# The render-parity harness (slice S-1)

`scripts/__check_render_parity.sh` boots the Python CMS stack twice, records the same
request list from each, and diffs the responses. It is the oracle every later slice
is checked against, so it is built to **fail**: a one-line change to a rendered page
must show up as a diff and a non-zero exit, and each capture must prove it reached the
surface it claims (status + a marker in the body), because two stacks that both
answer "please log in" compare equal and mean nothing.

## What it compares

* **Baseline** — `src/` at `--baseline-ref` (default `HEAD`), extracted with
  `git archive` into a temporary directory. It is this tree's own code, pinned to a
  ref so an uncommitted edit cannot move the baseline along with the candidate.
* **Candidate** — the working tree's `src/`, or `--candidate-src DIR` (another
  checkout, e.g. a later slice's lane, or a build whose service container replaces
  the Python one).

Both stacks run from the locally present stack image
(`ghcr.io/champyod/cms-docker-core:major-admin-panel`, overridable with
`CMS_PARITY_IMAGE`) with the tree's six Python packages bind-mounted over the image's
`site-packages`, so the process is the image's Python 3.12 running this tree's code.

One database container named `database` on `cms-network`. The schema is built once
(`cmsInitDB`, then the panel's Prisma migration history, which is where the roles and
the row-level-security policies come from), seeded once, and snapshotted with
`CREATE DATABASE … TEMPLATE`. Each capture restores that snapshot first, so the two
stacks answer from byte-identical data — a diff can only come from code.

## Normalisation

The whole soundness argument is in one place: `NORMALISERS` in `parity/parity.py`.
Each rule carries the observation that justifies it, and nothing else rewrites a
body. The rules that exist are the per-run values this stack actually emits:

| rule | what it rewrites | why it cannot be a behaviour |
|---|---|---|
| `xsrf-token` | the `_xsrf` form field | Tornado mints it per session from the cookie secret |
| `xsrf-cookie` | `_xsrf` in a cookie jar | the same token, mirrored |
| `session-cookie` | `awslogin` / `<contest>_login` values | embeds the login instant and a signature over it |
| `epoch-clock` | `1795285510.94982` | the server's clock handed to the page for the client-side countdown |
| `datetime` | `2026-11-21 18:23:19.904638` | a rendered instant: the seed time, or the instant of the request |

Compared per request: status, the headers that carry meaning (`content-type`,
`location`, `content-language`, `cache-control`), the set of cookie names, and the
normalised body. `date`, `server`, `content-length`, `etag` and cookie *values* are
not compared.

## The request list

`parity/requests.json`, in send order. A `login` entry performs a GET for the xsrf
token and then POSTs; the session cookie it sets is used by every later entry on that
stack, which is why order matters and why each entry carries an `expect` block.

Surfaces: contest landing (anonymous and participant), the CWS task-list API, task
statement, submission list, credits, the login pages and both login POSTs, two
permission-denied responses (CWS API without a session, admin page without the
permission), and the admin home, contest list, contest overview, contest submissions
and task list.

## Running it

```sh
scripts/__check_render_parity.sh --baseline-only     # boot + record, no diff
scripts/__check_render_parity.sh                     # HEAD vs working tree
scripts/__check_render_parity.sh --candidate-src /path/to/lane   # HEAD vs that lane
```

Exit codes: `0` no difference, `1` a difference, `2` the harness could not run,
`3` a surface did not answer what its `expect` block requires.

Cost: ~20 s warm, ~60 s cold (the Prisma migration history is the slow part).

## Why it is not in `scripts/__gates.sh`

That runner is the CI job `gates`, which has a checkout and no docker daemon; a gate
that needs a daemon and a 3.6 GB image would turn a green run into an infrastructure
failure. The harness is run by the lane that changes behaviour and by the reviewer of
that change, which is where "the response did not change" has to be evidenced.

## What it does not cover

Read paths only: no worker, no evaluation, no submission POST, no ranking web server
(`[proxy_service] rankings` is emptied in the generated config so ProxyService has no
external target). Those arrive with the slices that port them; the request list and
the normalisation table are the two places those additions go.
