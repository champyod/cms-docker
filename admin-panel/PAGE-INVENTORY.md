# Page inventory — what each page must tell the reader

One row per page that renders a surface. The archetype column is the layout it must use; the facts
column is what that page supplies, in reading order. A page supplies facts only — the layout owns
where they sit.

Legacy redirects are not listed: they forward an old address and render nothing.

Inventory: **32 of 55 pages documented.**

| Route | Archetype | Facts it must show (reading order) |
|---|---|---|
| `/` | dashboard | state of every service · totals per area · what happened most recently |
| `/administration/admins` | list | admins with id, username, name, last sign-in, the groups and override count each holds, and enabled state · sort · per-row edit, delete and enable toggle · create · what empty means |
| `/administration/audit` | list | recorded actions with timestamp, actor, verb, entity, result and reason, newest first · filter by entity, verb, actor, result, address, free text and date range, with sort · how many match against the whole log, paged · per-row expand to the before and after values, the session and the entry hash · export the narrowed set as CSV · live refresh on request · what empty means |
| `/administration/groups` | list | groups with name, description, seeded flag and the number of permissions each holds · sort · per-row edit and delete · create · what empty means. No filter and no total: the read returns every group in one pass, so there is nothing narrower to filter to and nothing left out to count |
| `/contests` | list | contests with id, name, state, active flag, window and their task and participant counts · filter by name or description, with sort · how many match against the whole set, paged · per-row edit, activate and delete · create · what empty means |
| `/contests/:id` | redirect | nothing of its own — it resolves the record and forwards to the overview tab, which renders the surface |
| `/contests/:id/communications` | board | the announcements published to this contest, each with author and time, its delete and its own empty meaning · the questions contestants asked, each with its asker, time, reply state, reply and ignore actions, and its own empty meaning · publish an announcement · a failed read instead of an empty section |
| `/contests/:id/countdown` | detail | the zone the contest's times are read in · when it starts, stops and when its analysis window opens and closes, each in that zone · the live clock counting to the next of those moments, with its stage |
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
| `/evaluation/submissions/:id/logs` | detail | the compilation outcome that produced this output, and how many lines it runs to · the compiler's output as one stream, stdout and stderr included, or what empty means |
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
| `/ranking` | detail | whether the ranking service reports its applied changes at all, and what it could not apply, counted per cause · that the board is live · the identity it opens with: display name, shown contest, title, subtitle, organisation and access mode · the standings of the previewed contest, each task as a column, and the progress graph over the first twenty · the logo it carries, with upload · what empty means (no contest on the board) |
| `/ranking/appearance` | settings | the identity values: title, subtitle, organisation and display name · the display values: access mode, id column, anonymity, footer and credits text · the advanced JSON: theme, score format and perspective tabs · who the save reaches · save, and a read-only notice when ranking:appearance is absent |
| `/ranking/credits` | settings | the credit list the board attributes its licences to, with the vendored file named as the fallback · who the save reaches · save, and a read-only notice when ranking:appearance is absent |
| `/ranking/users` | board | which contests the board draws, each with its kind, reason and author · the shard being edited · overrides with target, contest, reason, author and orphan state, filtered, selected, ended one by one or in bulk · the rows the board actually drops, with the write that hides each · what empty means per section |
| `/ranking/users/:key` | detail | the participant's name, username, team, total, rank and whether the public board hides them · the score each task awarded · the overrides active on this user in this contest, with the add surface · what empty means for scores and overrides |
| `/search` | list | — *to inventory* |
| `/security/blocks` | board | captcha settings, thresholds and provider health · banned addresses with their unban, plus the queue-by-address control · permanent exemptions with revoke, beside the grant form · live failure counters, each expandable to the attempts behind it · open lockouts with unlock · what each section means when empty |
| `/security/overview` | dashboard | the patching signal (does anything need me now) · when the numbers were read · ten counts: waf state, waf alerts, banned addresses, lockouts, certificates expiring, host agent reporting, stale images, unresolved CVEs, expired waivers, host OS updates |
| `/security/patching` | list | whether a waiver now covers a reachable finding, and the way to those rows · findings by producer with severity, reachability, version, host and waiver state · filter by source, severity, reachability and waiver fit, with sort · how many match against the whole feed, and the feed's four totals · waive one row · waive every unreachable finding · what empty means |
| `/security/tls` | detail | TLS proxy and certbot status · certificate lineages with expiry and days left · unreadable lineages · queue a renewal with a reason |
| `/security/waf` | list | — *to inventory* |
| `/system/about` | settings | — *to inventory* |
| `/system/appearance` | settings | — *to inventory* |
| `/system/backup-restore` | settings | — *to inventory* |
| `/system/docs` | settings | — *to inventory* |
| `/system/maintenance` | settings | — *to inventory* |
| `/system/settings` | settings | whether a restart is pending · the environment group and the monitor group, each with who it reaches · per-section save, with and without restart · the monitor targets and their state |
| `/tasks` | list | tasks with id, name, title, the contests they belong to, resources and submission count · filter, with sort · how many match against the whole set, paged · per-row edit and delete · assign and unassign the checked rows, edit their limits · create · what empty means |
| `/tasks/:id` | redirect | nothing of its own — it resolves the record and forwards to the overview tab, which renders the surface |
| `/tasks/:id/datasets` | detail | how many datasets the task holds, which one is live and how many testcases they carry · each dataset's type, limits and score type, with make-live, clone, rename, autojudge, settings and delete · its testcases, each with its public state and delete · what empty means · add a dataset, and bulk-upload testcases into one |
| `/tasks/:id/files` | detail | how many files the task carries · each attachment's filename, downloadable, with delete · what empty means · upload one |
| `/tasks/:id/overview` | detail | the task's score mode, feedback level, score precision and submission count · each statement's language, file, size and upload day, each downloadable and deletable · upload a statement |
| `/tasks/:id/settings` | settings | the score mode, feedback level, score precision and token mode the task holds · who a change to them reaches · where the edit that writes them lives |
| `/teams/:id` | detail | — *to inventory* |

## How a row is finished

1. Name the question each fact answers, in the words the operator would use.
2. Drop every fact that does not change what the operator does next.
3. If the same fact appears on two pages, one of them is wrong.
