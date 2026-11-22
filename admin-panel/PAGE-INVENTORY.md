# Page inventory — what each page must tell the reader

One row per page that renders a surface. The archetype column is the layout it must use; the facts
column is what that page supplies, in reading order. A page supplies facts only — the layout owns
where they sit.

Legacy redirects are not listed: they forward an old address and render nothing.

Inventory: **9 of 59 pages documented.**

| Route | Archetype | Facts it must show (reading order) |
|---|---|---|
| `/` | dashboard | state of every service · totals per area · what happened most recently |
| `/administration/admins` | list | — *to inventory* |
| `/administration/audit` | list | — *to inventory* |
| `/administration/groups` | list | — *to inventory* |
| `/contests` | list | state of the contest service · contests with state, window and age · count against total · filter · per-row actions · create |
| `/contests/:id` | detail | contest identity and state · window and rule facts · participants and tasks it owns · actions · change history |
| `/contests/:id/communications` | detail | — *to inventory* |
| `/contests/:id/countdown` | detail | — *to inventory* |
| `/contests/:id/overview` | detail | — *to inventory* |
| `/contests/:id/participants` | detail | — *to inventory* |
| `/contests/:id/ranking` | detail | — *to inventory* |
| `/contests/:id/settings` | settings | — *to inventory* |
| `/contests/:id/tasks` | detail | — *to inventory* |
| `/evaluation/lanes` | list | lanes with queue depth and state · per-lane actions · live refresh |
| `/evaluation/submissions` | list | — *to inventory* |
| `/evaluation/submissions/:id` | detail | — *to inventory* |
| `/evaluation/submissions/:id/evaluation` | detail | — *to inventory* |
| `/evaluation/submissions/:id/history` | detail | — *to inventory* |
| `/evaluation/submissions/:id/logs` | detail | — *to inventory* |
| `/evaluation/submissions/:id/results` | detail | — *to inventory* |
| `/evaluation/submissions/:id/summary` | detail | — *to inventory* |
| `/infrastructure/containers` | list | — *to inventory* |
| `/infrastructure/deployments` | list | — *to inventory* |
| `/infrastructure/resources` | list | — *to inventory* |
| `/infrastructure/services` | list | — *to inventory* |
| `/people/teams` | list | teams with member count and state · count against total · sort · per-row actions · create · live refresh |
| `/people/teams/:id` | detail | — *to inventory* |
| `/people/teams/:id/contests` | detail | — *to inventory* |
| `/people/teams/:id/members` | detail | — *to inventory* |
| `/people/teams/:id/overview` | detail | — *to inventory* |
| `/people/users` | list | users with name, username, team, status and participations · count against total · search · sort · per-row edit and delete · create, bulk add and bulk edit |
| `/people/users/:id` | detail | — *to inventory* |
| `/people/users/:id/history` | detail | — *to inventory* |
| `/people/users/:id/profile` | detail | — *to inventory* |
| `/people/users/:id/teams` | detail | — *to inventory* |
| `/ranking` | list | — *to inventory* |
| `/ranking/appearance` | settings | — *to inventory* |
| `/ranking/credits` | list | — *to inventory* |
| `/ranking/users` | list | — *to inventory* |
| `/ranking/users/:key` | list | — *to inventory* |
| `/search` | list | — *to inventory* |
| `/security/blocks` | board | captcha settings, thresholds and provider health · banned addresses with their unban, plus the queue-by-address control · permanent exemptions with revoke, beside the grant form · live failure counters, each expandable to the attempts behind it · open lockouts with unlock · what each section means when empty |
| `/security/overview` | list | — *to inventory* |
| `/security/patching` | list | whether a waiver now covers a reachable finding, and the way to those rows · findings by producer with severity, reachability, version, host and waiver state · filter by source, severity, reachability and waiver fit, with sort · how many match against the whole feed, and the feed's four totals · waive one row · waive every unreachable finding · what empty means |
| `/security/tls` | detail | TLS proxy and certbot status · certificate lineages with expiry and days left · unreadable lineages · queue a renewal with a reason |
| `/security/waf` | list | — *to inventory* |
| `/system/about` | settings | — *to inventory* |
| `/system/appearance` | settings | — *to inventory* |
| `/system/backup-restore` | settings | — *to inventory* |
| `/system/docs` | settings | — *to inventory* |
| `/system/maintenance` | settings | — *to inventory* |
| `/system/settings` | settings | whether a restart is pending · the environment group and the monitor group, each with who it reaches · per-section save, with and without restart · the monitor targets and their state |
| `/tasks` | list | — *to inventory* |
| `/tasks/:id` | detail | — *to inventory* |
| `/tasks/:id/datasets` | detail | — *to inventory* |
| `/tasks/:id/files` | detail | — *to inventory* |
| `/tasks/:id/overview` | detail | — *to inventory* |
| `/tasks/:id/settings` | settings | — *to inventory* |
| `/teams/:id` | detail | — *to inventory* |

## How a row is finished

1. Name the question each fact answers, in the words the operator would use.
2. Drop every fact that does not change what the operator does next.
3. If the same fact appears on two pages, one of them is wrong.
