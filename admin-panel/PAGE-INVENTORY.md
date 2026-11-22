# Page inventory — what each page must tell the reader

One row per page that renders a surface. The archetype column is the layout it must use; the facts
column is what that page supplies, in reading order. A page supplies facts only — the layout owns
where they sit.

Legacy redirects are not listed: they forward an old address and render nothing.

Inventory: **0 of 0 pages documented.**

| Route | Archetype | Facts it must show (reading order) |
|---|---|---|
| `/` | dashboard | state of every service · totals per area · what happened most recently |
| `/administration/admins` | list | admins with id, username, name, last sign-in, the groups and override count each holds, and enabled state · sort · per-row edit, delete and enable toggle · create · what empty means |
| `/administration/audit` | list | — *to inventory* |
| `/administration/groups` | list | — *to inventory* |
| `/contests` | list | contests with id, name, state, active flag, window and their task and participant counts · filter by name or description, with sort · how many match against the whole set, paged · per-row edit, activate and delete · create · what empty means |
| `/contests/:id` | redirect | nothing of its own — it resolves the record and forwards to the overview tab, which renders the surface |
| `/contests/:id/communications` | detail | — *to inventory* |
| `/contests/:id/countdown` | detail | — *to inventory* |
| `/contests/:id/overview` | detail | the state the contest is in now and the zone its timings are read in · the four timing fields it edits (start, stop, analysis start, analysis stop), each with its own error · save |
| `/contests/:id/participants` | board | the people and teams in this contest, with their team, unrestricted and hidden state · per-row mark as test, settings and remove · add a participant or a whole team · the registration roster: which teams registration offers, each row's state and its own empty meaning · read-only when team:update is absent |
| `/contests/:id/ranking` | board | the contest's standings: every participant's rank, username, score per task and total · the progress graph over the first twenty · what empty means (the table says no submissions yet) |
| `/contests/:id/settings` | settings | the contest's name, description and zone · what it allows: questions, user tests, submission download, password auth, registration, analysis mode · the scope each change reaches · save, and a locked form when contest:update is absent |
| `/contests/:id/tasks` | list | the tasks this contest carries, by name and title · filter by name or title, with select-all over the filtered set · how many are assigned in total · per-row open and remove · attach and detach the selection · create a task and add it · what empty means |
| `/evaluation/lanes` | list | lanes with queue depth and state · per-lane actions · live refresh |
| `/evaluation/submissions` | list | submissions with id, time, submitter and contest, task, language, judging status and score · filter by contest, task, user or free text, with sort · how many match against the whole set, paged · per-row view, rejudge and official toggle · bulk rescore, official and comment over the checked rows or the whole filtered set · live refresh · what empty means |
| `/evaluation/submissions/:id` | redirect | forwards to the record's default tab; it renders no surface of its own |
| `/evaluation/submissions/:id/evaluation` | detail | how many testcases were evaluated and how many failed · each testcase's verdict, time and memory, expandable to its input, expected output and the submission's output, or to the reason those bytes are withheld |
| `/evaluation/submissions/:id/history` | detail | who made the latest recorded change, what it was and when · every recorded change, with its actor, action, result, reason and time, newest first, or what empty means · a failed read instead of an empty list |
| `/evaluation/submissions/:id/logs` | detail | — *to inventory* |
| `/evaluation/submissions/:id/results` | detail | how many datasets were judged and how many compilations failed · each dataset's score, compilation outcome, evaluation outcome, time, memory, public score and when it was scored · the stored files, each downloadable · what empty means |
| `/evaluation/submissions/:id/summary` | detail | the submission's language and comment, and when it arrived · the stored source, with a diff against the previous submission where one exists · which outcome tabs this reader may open, and which of them are not readable |
| `/infrastructure/containers` | list | — *to inventory* |
| `/infrastructure/deployments` | list | — *to inventory* |
| `/infrastructure/resources` | list | — *to inventory* |
| `/infrastructure/services` | board | the problems a sync would refuse · services with role, host, ports, contest and enabled state, each editable and removable · wirings with their relation · exposures with hostname, path, owner and TLS, a curated one without an editor · the artifacts the next sync renders, each with its hot-apply class · what empty means per section |
| `/people/teams` | list | teams with id, code, name, registerable flag, member count and organization · sort · per-row edit and delete · create · live refresh · what empty means. No filter and no total: the read returns every team in one pass, so there is no narrower set and nothing left out to count against |
| `/people/teams/:id` | detail | — *to inventory* |
| `/people/teams/:id/contests` | detail | — *to inventory* |
| `/people/teams/:id/members` | detail | — *to inventory* |
| `/people/teams/:id/overview` | detail | the team's leader and member count · the code, name and registerable flag, each editable in place · save, and delete with confirmation · read-only when team:update is absent |
| `/people/users` | list | users with name, username, team, status and participations · count against total · search · sort · per-row edit and delete · create, bulk add and bulk edit |
| `/people/users/:id` | redirect | forwards to the record's default tab; it renders no surface of its own |
| `/people/users/:id/history` | detail | — *to inventory* |
| `/people/users/:id/profile` | detail | — *to inventory* |
| `/people/users/:id/teams` | detail | — *to inventory* |
| `/ranking` | list | — *to inventory* |
| `/ranking/appearance` | settings | — *to inventory* |
| `/ranking/credits` | list | — *to inventory* |
| `/ranking/users` | board | which contests the board draws, each with its kind, reason and author · the shard being edited · overrides with target, contest, reason, author and orphan state, filtered, selected, ended one by one or in bulk · the rows the board actually drops, with the write that hides each · what empty means per section |
| `/ranking/users/:key` | list | — *to inventory* |
| `/search` | board | what was searched for, and that nothing matched when nothing did · users with username and name, each opening its profile · tasks with name and title · contests with name and description · admins with username and name, with no page to open · what each kind means when it matched nothing |
| `/security/blocks` | board | captcha settings, thresholds and provider health · banned addresses with their unban, plus the queue-by-address control · permanent exemptions with revoke, beside the grant form · live failure counters, each expandable to the attempts behind it · open lockouts with unlock · what each section means when empty |
| `/security/overview` | dashboard | the patching signal (does anything need me now) · when the numbers were read · ten counts: waf state, waf alerts, banned addresses, lockouts, certificates expiring, host agent reporting, stale images, unresolved CVEs, expired waivers, host OS updates |
| `/security/patching` | list | whether a waiver now covers a reachable finding, and the way to those rows · findings by producer with severity, reachability, version, host and waiver state · filter by source, severity, reachability and waiver fit, with sort · how many match against the whole feed, and the feed's four totals · waive one row · waive every unreachable finding · what empty means |
| `/security/tls` | detail | TLS proxy and certbot status · certificate lineages with expiry and days left · unreadable lineages · queue a renewal with a reason |
| `/security/waf` | detail | whether the container runs, how many alerts parsed and how many audit lines could not be parsed · the engine mode, response-body access, paranoia level and anomaly thresholds, each saved with a reason · sync, recreate and restart the container, each with a reason · the latest parsed alerts with address, uri, rule ids, score and whether they blocked. No header action: every write needs the reason field that sits beside it |
| `/system/about` | detail | the panel's project, its upstream and its licence, and how many components it ships · the byline with the source and licence addresses · contributors, and what each contributed · the panel's own first-party paths · every third-party asset with version, holder, licence and the paths it covers. No action: nothing on this page changes the panel |
| `/system/appearance` | settings | — *to inventory* |
| `/system/backup-restore` | settings | — *to inventory* |
| `/system/docs` | board | contests: how timing, analysis mode and submission limits work · users: teams, and the participation constraints a contest applies · tasks: task types, datasets and scoring · submissions: what evaluation does and what invalidates a result · services: the three services a stack runs. Static reference: it states no state and no freshness, because nothing on it is read or can be wrong |
| `/system/maintenance` | settings | — *to inventory* |
| `/system/settings` | settings | whether a restart is pending · the environment group and the monitor group, each with who it reaches · per-section save, with and without restart · the monitor targets and their state |
| `/tasks` | list | tasks with id, name, title, the contests they belong to, resources and submission count · filter, with sort · how many match against the whole set, paged · per-row edit and delete · assign and unassign the checked rows, edit their limits · create · what empty means |
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
