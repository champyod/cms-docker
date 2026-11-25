# API Surface - the write surface the Rust admin API must expose

Measured before a route or a line of Rust server code exists. The Next.js admin
panel keeps its UI and stops writing the database directly; its server actions
must call a Rust write API, the Python admin's routes/templates are deleted
rather than ported, and one Rust process owns every database write. This
document is the measurement that bounds that refactor: it collapses every
panel server action and every Python mutating handler into one table of write
operations, with the permission the Rust route must enforce and the tables the
operation writes. Every claim carries a `path:line`.

Rules of this document: reads are excluded from the table and listed in the
appendix (section 5) so the write count is not inflated; host-access operations
(section 4) are rows in the table but are **not API work** and are counted
separately; an operation both surfaces perform is collapsed into a single row
naming both sources. Where a file is ambiguous it is flagged in the row and in
section 8, not filled in. Method+path is a proposed shape, not a designed
endpoint.

## 1. Re-counting the inventory claims

The two inventories were written against an earlier tree. Re-measured on this
checkout (`feat/rust-api-surface` @ `cc724ee6`), the headline numbers are:

| Claim | Source of claim | Measured | Command |
|---|---|---|---|
| 147 panel server actions | `dev/PHASE0-INVENTORY.md:17` | **239** | `grep -rl "'use server'" admin-panel/src/app/actions --include='*.ts' | xargs grep -h '^export async function' | wc -l` |
| "none of them call an API route" | `dev/PHASE0-INVENTORY.md:17`, `:23-25` | still true: 0 internal calls; the 2 `fetch(` in actions are outbound (`actions/monitor.ts:170`, `actions/evaluation-lanes-board.ts:86`) | `grep -rn 'fetch(' admin-panel/src/app/actions --include='*.ts'` |
| 28 panel API routes | `dev/migration/INVENTORY.md:84`, `dev/PHASE0-INVENTORY.md:16` | **52** `route.ts` files | `find admin-panel/src/app/api -name route.ts | wc -l` |
| one API route delegates to a server action | `dev/PHASE0-INVENTORY.md:28-29` | 1 real delegation (of 4 `@/app/actions/` imports): `api/submissions/[id]/route.ts:9` -> `actions/submissions.ts` | `grep -rl "@/app/actions/" admin-panel/src/app/api --include=route.ts \| xargs grep -hoE "@/app/actions/[A-Za-z0-9_-]+" \| sort -u \| while read a; do grep -q "'use server'" "admin-panel/src/${a#@/}.ts" && echo "$a"; done` -> 1 (`submissions`); the other 3 imports target helper modules with no `'use server'` |
| 75 Python routes | `dev/migration/INVENTORY.md:42-43` | **76** (`/credits` added at `handlers/__init__.py:122`) | `grep -cE '^\s*\(r"' src/cms/server/admin/handlers/__init__.py` |
| 55 mutating Python handlers / 11 of 16 modules | `dev/PHASE0-INVENTORY.md:10` | **55 across 11 modules** (unchanged) | `grep -rnE '^\s*def (post|delete)\(' src/cms/server/admin/handlers/*.py | wc -l` |
| 95 `@require_permission` applications | `dev/PHASE0-INVENTORY.md:11` | **96** | `grep -rn '@require_permission' src/cms/server/admin/handlers/ | wc -l` |

The panel grew from the 29 action files / 147 actions the inventories describe
(`dev/migration/INVENTORY.md:103-108`) to 66 `.ts` files, 55 of them `'use
 server'`, holding 239 exported async functions. Of the 52 `route.ts` files,
only `api/submissions/[id]/route.ts:5-9` imports actual server actions
(`updateSubmissionComment`, `toggleSubmissionOfficial`, `recalculateSubmission`);
`testcases/route.ts:8`, `users/bulk/route.ts:8` and
`evaluation/lanes/stream/route.ts:1` import from helper modules that carry no
`'use server'` directive, so they are not action delegations. Every other route
still writes Prisma directly (`dev/migration/INVENTORY.md:123-133`).

## 2. Permission model - one permission per route

The Rust API must enforce exactly one permission key on each route. The two
surfaces resolve permissions differently and that divergence is part of what
this document must collapse:

- **Panel.** Keys are defined in the registry `admin-panel/src/lib/permission-registry.ts:20-57`
  (35 modules x 5 CRUD verbs) plus `DOMAIN_VERBS` at `:62-140`; `ACTION_PERMISSIONS`
  maps action names to keys at `admin-panel/src/lib/permission-engine.ts:19-48`. Actions
  gate with `ensurePermission` (e.g. `actions/datasets.ts:29`) or, for core CRUD,
  with `requirePermission` in the service layer (`lib/services/contests.ts:51,81,103`).
- **Python.** The `@require_permission` decorator is `handlers/base.py:325-382`; it reads
  effective permissions from the `permissions` DB table (`src/cms/db/permissions.py:29-43`),
  not from a constant. 96 applications across the 16 handler modules.
- **`all:all` expands from two different universes** (`dev/PHASE0-INVENTORY.md:42-44`):
  the TS registry constant vs the Python DB row set. Only the TS registry is
  guaranteed complete, so the Rust API should take its key set from the registry.

Every permission key used by a Python mutating handler has a counterpart in the
panel registry (all of `admin:create`, `manager:create`, `dataset:switch`,
`question:answer`, `message:send`, `statement:create`, etc. appear in
`permission-registry.ts`). There is therefore **no Python-only permission**;
what is Python-only is the *operation*: `manager:create`/`manager:delete`
(`dataset.py:360,400`) and the user/team CRUD have no panel *server action* -
they are panel API routes or absent - and are marked `Python-only` in section 3.
Two keys diverge for one operation: dataset activation is `dataset:switch` in
Python (`dataset.py:279`) but `dataset:update` + `task:switch_dataset` in the
panel (`actions/datasets.ts:157-160`); the Rust route must pick one
(`dev/PHASE0-INVENTORY.md:58-59`). Rows below name the panel key where one
exists and mark the divergence.

## 3. Route table - collapsed write operations

`Today` cites the panel action (`admin-panel/src/app/actions/...:line`) and/or
the Python handler (`src/cms/server/admin/handlers/...:line`). `Tables written`
comes from the action body's Prisma/`$executeRaw` calls or the handler's session
writes; the write site is cited in parentheses. `Host access?` = `No` marks a
database write that becomes a Rust API route; `yes` marks host work (section 4).

| Operation | Today (panel action / Python handler) | Method + path | Permission | Tables written | Host access? |
|---|---|---|---|---|---|
| **Submission** | | | | | |
| update submission comment | admin-panel/src/app/actions/submissions.ts:134 updateSubmissionComment() <br> src/cms/server/admin/handlers/submission.py:177 SubmissionCommentHandler.post() | PATCH /submissions/:id/comment | submission:update | submissions (actions/submissions.ts submissions.update) | No |
| set / toggle submission official | admin-panel/src/app/actions/submissions.ts:163 toggleSubmissionOfficial(); :228 setSubmissionOfficial() <br> src/cms/server/admin/handlers/submission.py:201 SubmissionOfficialStatusHandler.post() | PATCH /submissions/:id/official | submission:update | submissions (actions/submissions.ts submissions.updateMany) | No |
| recalculate / rejudge submission(s) | admin-panel/src/app/actions/submissions.ts:293 recalculateSubmission(); :537 recalculateSubmissions(); :574 recalculateSubmissionIds() <br> (none — Python admin has no rejudge route) | POST /submissions/recalculate | submission:recompute / submission:rejudge (+ evaluation:delete, submissionresult:delete) | evaluations, submission_results, submissions (actions/submissions.ts evaluations.deleteMany, submission_results.deleteMany) — also RPC to EvaluationService | No |
| apply comment to submissions (bulk) | admin-panel/src/app/actions/submissions.ts:734 applyCommentToSubmissions(); :761 applyCommentToSubmissionIds() | POST /submissions/comment/bulk | submission:update | submissions (actions/submissions.ts submissions.updateMany) | No |
| **Contest** | | | | | |
| create contest | admin-panel/src/app/actions/contests.ts:15 createContest() <br> src/cms/server/admin/handlers/contest.py:51 AddContestHandler.post() | POST /contests | contest:create | contests (services/contests.ts:72 insertContestRow) | No |
| update contest | admin-panel/src/app/actions/contests.ts:21 updateContest(); contests.ts:57 updateContestSettings() <br> src/cms/server/admin/handlers/contest.py:83 ContestHandler.post() | PATCH /contests/:id | contest:update | contests (contests-repo.ts:283 $executeRaw UPDATE) | No |
| delete contest | admin-panel/src/app/actions/contests.ts:27 deleteContest() <br> src/cms/server/admin/handlers/contest.py:229 RemoveContestHandler.delete() | DELETE /contests/:id | contest:delete | contests (services/contests.ts:106 prisma.contests.delete) | No |
| activate / switch active contest | admin-panel/src/app/actions/contests.ts:75 activateContest() | POST /contests/:id/activate | contest:switch | contests.is_active (active-contest.ts:19,23 $executeRaw); also writes config.toml — AMBIGUOUS, see §8 | No |
| add participant (enrol user) | admin-panel/src/app/actions/contests.ts:33 addParticipant(); participations.ts:121 addTeamToContest() <br> src/cms/server/admin/handlers/contestuser.py:148 AddContestUserHandler.post(); user.py:332 AddParticipationHandler.post() | POST /contests/:id/participants | participation:create | participations (services/contests.ts:123 $executeRaw INSERT) | No |
| remove participant | admin-panel/src/app/actions/contests.ts:39 removeParticipant() <br> src/cms/server/admin/handlers/contestuser.py:124 RemoveParticipationHandler.delete(); contestuser.py:70 ContestUsersHandler.post(); user.py:369 EditParticipationHandler.post() | DELETE /participations/:id | participation:delete | participations (services/contests.ts:145 prisma.participations.delete) | No |
| update participation | admin-panel/src/app/actions/participations.ts:23 updateParticipation(); participations.ts:67 setTestUser() <br> src/cms/server/admin/handlers/contestuser.py:206 ParticipationHandler.post() | PATCH /participations/:id | participation:update | participations (actions/participations.ts:147 $executeRaw; users/batch/enrollmentActions.ts) | No |
| attach task to contest | admin-panel/src/app/actions/contests.ts:45 addTaskToContest(); tasks.ts:48 assignTaskToContest(); contest-tasks.ts:29 attachContestTasks() <br> src/cms/server/admin/handlers/contesttask.py:174 AddContestTaskHandler.post(); contesttask.py:69 ContestTasksHandler.post() | POST /contests/:id/tasks | task:update | contest_tasks, tasks (services/tasks.ts contest_tasks.create) | No |
| detach task from contest | admin-panel/src/app/actions/contests.ts:51 removeTaskFromContest(); contest-tasks.ts:44 detachContestTasks() | DELETE /contests/:id/tasks/:taskId | task:update | contest_tasks, tasks (services/tasks.ts contest_tasks.deleteMany) | No |
| contest team roster / registerable | admin-panel/src/app/actions/contestTeams.ts:59 setContestTeamRegisterable(); :71 addTeamToRoster(); :78 removeTeamFromRoster() | POST /contests/:id/teams | team:update / participation:update | contest_teams (actions/contestTeams.ts contest_teams.upsert/create/delete) | No |
| rotate contestant accounts / usernames | admin-panel/src/app/actions/contest-accounts.ts:30 rotateContestAccounts() | POST /contests/:id/accounts/rotate | username:set (+ participation:update) | participations.username (panel-actions/contest-accounts.ts:68,80 $executeRaw) | No |
| **Task** | | | | | |
| create task | admin-panel/src/app/actions/tasks.ts:30 createTask() <br> src/cms/server/admin/handlers/task.py:53 AddTaskHandler.post() | POST /tasks | task:create | tasks | No |
| update task | admin-panel/src/app/actions/tasks.ts:36 updateTask() <br> src/cms/server/admin/handlers/task.py:126 TaskHandler.post() | PATCH /tasks/:id | task:update | tasks (services/tasks.ts:122,183 $executeRawUnsafe UPDATE) | No |
| delete task | admin-panel/src/app/actions/tasks.ts:42 deleteTask() <br> src/cms/server/admin/handlers/task.py:504 RemoveTaskHandler.delete() | DELETE /tasks/:id | task:delete | tasks (+ sibling renumber; services/tasks.ts tasks.delete) | No |
| add statement | admin-panel/src/app/actions/statements.ts:19 addStatement() <br> src/cms/server/admin/handlers/task.py:241 AddStatementHandler.post() | POST /tasks/:id/statements | statement:create | statements, fsobjects (actions/statements.ts:32 $executeRaw; fsobjects.ts:26) | No |
| delete statement | admin-panel/src/app/actions/statements.ts:53 deleteStatement() <br> src/cms/server/admin/handlers/task.py:300 StatementHandler.delete() | DELETE /statements/:id | statement:delete | statements (actions/statements.ts statements.delete) | No |
| add attachment | admin-panel/src/app/actions/statements.ts:86 addAttachment() <br> src/cms/server/admin/handlers/task.py:329 AddAttachmentHandler.post() | POST /tasks/:id/attachments | attachment:create | attachments, fsobjects (actions/statements.ts:93 $executeRaw) | No |
| delete attachment | admin-panel/src/app/actions/statements.ts:114 deleteAttachment() <br> src/cms/server/admin/handlers/task.py:372 AttachmentHandler.delete() | DELETE /attachments/:id | attachment:delete | attachments (actions/statements.ts attachments.delete) | No |
| **User** | | | | | |
| create user | (panel: API route api/users/route.ts:49 POST, api/users/bulk/route.ts:133 POST — no server action) <br> src/cms/server/admin/handlers/user.py:291 AddUserHandler.post() | POST /users | user:create | users (api/users/route.ts users.create; bulk/route.ts users.create) | No |
| update user | (panel: API route api/users/[id]/route.ts:17 PUT, batch/* — no server action) <br> src/cms/server/admin/handlers/user.py:57 UserHandler.post() | PATCH /users/:id | user:update | users (api/users/[id]/route.ts users.update; batch/profileActions.ts) | No |
| delete user | (panel: API route api/users/[id]/route.ts:67 DELETE — no server action) <br> src/cms/server/admin/handlers/user.py:159 RemoveUserHandler.delete() | DELETE /users/:id | user:delete | users (api/users/[id]/route.ts users.delete) | No |
| create admin | admin-panel/src/app/actions/admins.ts:87 createAdmin() <br> src/cms/server/admin/handlers/admin.py:81 AddAdminHandler.post() | POST /admins | admin:create | admins (actions/admins.ts admins.create) | No |
| update admin | admin-panel/src/app/actions/admins.ts:118 updateAdmin() <br> src/cms/server/admin/handlers/admin.py:146 AdminHandler.post() | PATCH /admins/:id | admin:update | admins (admin-update-helpers.ts admins.update) | No |
| delete admin | admin-panel/src/app/actions/admins.ts:165 deleteAdmin() <br> src/cms/server/admin/handlers/admin.py:254 AdminHandler.delete() | DELETE /admins/:id | admin:delete | admins (actions/admins.ts admins.delete) | No |
| **Team** | | | | | |
| create team | admin-panel/src/app/actions/teams.ts:33 createTeam() <br> src/cms/server/admin/handlers/user.py:258 AddTeamHandler.post() | POST /teams | team:create | teams (actions/teams.ts teams.create) | No |
| update team | admin-panel/src/app/actions/teams.ts:60 updateTeam(); contestTeams.ts:33 (roster) <br> src/cms/server/admin/handlers/user.py:226 TeamHandler.post() | PATCH /teams/:id | team:update | teams (actions/teams.ts teams.update) | No |
| delete team | admin-panel/src/app/actions/teams.ts:85 deleteTeam() <br> src/cms/server/admin/handlers/user.py:189 RemoveTeamHandler.delete() | DELETE /teams/:id | team:delete | teams (actions/teams.ts teams.delete) | No |
| add users to team / apply team participation | admin-panel/src/app/actions/team-members.ts:30 addUsersToTeamByUsername(); :67 applyTeamParticipationSettings() | POST /teams/:id/members | participation:update | participations (participation-sql.ts:110,175 $executeRawUnsafe) | No |
| **Dataset** | | | | | |
| create / add dataset | admin-panel/src/app/actions/datasets.ts:25 createDataset() <br> src/cms/server/admin/handlers/task.py:414 AddDatasetHandler.post(); dataset.py:114 CloneDatasetHandler.post() | POST /tasks/:id/datasets | dataset:create | datasets, testcases, managers (dataset-cloning.ts) | No |
| clone dataset | admin-panel/src/app/actions/datasets.ts:83 cloneDataset() <br> src/cms/server/admin/handlers/dataset.py:114 CloneDatasetHandler.post() | POST /datasets/:id/clone | dataset:create | datasets, testcases, managers (lib/dataset-cloning.ts) | No |
| rename / update / autojudge dataset | admin-panel/src/app/actions/datasets.ts:106 renameDataset(); :235 updateDataset(); :179 toggleAutojudge() <br> src/cms/server/admin/handlers/dataset.py:194 RenameDatasetHandler.post(); :326 ToggleAutojudgeDatasetHandler.post() | PATCH /datasets/:id | dataset:update | datasets (actions/datasets.ts datasets.update x3) | No |
| delete dataset | admin-panel/src/app/actions/datasets.ts:130 deleteDataset() <br> src/cms/server/admin/handlers/dataset.py:236 DeleteDatasetHandler.post() | DELETE /datasets/:id | dataset:delete | datasets (actions/datasets.ts datasets.delete) | No |
| activate / switch dataset | admin-panel/src/app/actions/datasets.ts:156 activateDataset() <br> src/cms/server/admin/handlers/dataset.py:279 ActivateDatasetHandler.post() | POST /datasets/:id/activate | dataset:switch (panel also task:switch_dataset; Python dataset:switch — see §2) | datasets, tasks (actions/datasets.ts tasks.update) | No |
| add dataset manager | (panel: API route api/datasets/[id]/managers/route.ts:26 POST — no server action) <br> src/cms/server/admin/handlers/dataset.py:360 AddManagerHandler.post() | POST /datasets/:id/managers | manager:create | managers (lib/dataset-cloning.ts managers.create; api/datasets/[id]/managers/route.ts:46 $executeRaw) | No |
| delete dataset manager | (panel: API route api/managers/[id]/route.ts:6 DELETE — no server action) <br> src/cms/server/admin/handlers/dataset.py:400 DeleteManagerHandler.delete() | DELETE /managers/:id | manager:delete | managers (api/managers/[id]/route.ts managers.delete) | No |
| **Testcase** | | | | | |
| add testcase | admin-panel/src/app/actions/testcases.ts:16 addTestcase() <br> src/cms/server/admin/handlers/dataset.py:432 AddTestcaseHandler.post(); :504 AddTestcasesHandler.post() | POST /datasets/:id/testcases | testcase:create | testcases (actions/testcases.ts testcases.create; testcase-upload.ts) | No |
| delete testcase | admin-panel/src/app/actions/testcases.ts:65 deleteTestcase() <br> src/cms/server/admin/handlers/dataset.py:556 DeleteTestcaseHandler.delete() | DELETE /testcases/:id | testcase:delete | testcases (actions/testcases.ts testcases.delete) | No |
| set testcase public | admin-panel/src/app/actions/testcases.ts:88 toggleTestcasePublic(); :126 updateTestcasesPublic() | PATCH /testcases/:id | testcase:update | testcases (actions/testcases.ts testcases.update / updateMany) | No |
| **Announcement** | | | | | |
| create / publish announcement | admin-panel/src/app/actions/announcements.ts:19 createAnnouncement() <br> src/cms/server/admin/handlers/contestannouncement.py:48 AddAnnouncementHandler.post() | POST /announcements | announcement:create / announcement:publish | announcements (actions/announcements.ts announcements.create) | No |
| update announcement | admin-panel/src/app/actions/announcements.ts:58 updateAnnouncement() | PATCH /announcements/:id | announcement:update | announcements (actions/announcements.ts announcements.update) | No |
| delete announcement | admin-panel/src/app/actions/announcements.ts:91 deleteAnnouncement() <br> src/cms/server/admin/handlers/contestannouncement.py:71 AnnouncementHandler.delete() | DELETE /announcements/:id | announcement:delete | announcements (actions/announcements.ts announcements.delete) | No |
| **Question** | | | | | |
| reply / claim question | admin-panel/src/app/actions/questions.ts:27 replyToQuestion() <br> src/cms/server/admin/handlers/contestquestion.py:118 QuestionReplyHandler.post(); :176 QuestionClaimHandler.post() | POST /questions/:id/reply | question:answer | questions (actions/questions.ts questions.update x3) | No |
| ignore / unignore question | admin-panel/src/app/actions/questions.ts:70 ignoreQuestion(); :98 unignoreQuestion() <br> src/cms/server/admin/handlers/contestquestion.py:154 QuestionIgnoreHandler.post() | POST /questions/:id/ignore | question:ignore | questions (actions/questions.ts questions.update) | No |
| **Message** | | | | | |
| send message to participant | admin-panel/src/app/actions/participations.ts:216 sendMessage() <br> src/cms/server/admin/handlers/contestuser.py:269 MessageHandler.post() | POST /messages | message:send (+ message:create) | messages (actions/participations.ts messages.create) | No |
| **Worker** | | | | | |
| update worker fleet config | admin-panel/src/app/actions/workerConfig.ts:111 updateWorkers() | — (host) | settings:update | none — filesystem worker config (workerConfig.ts:122-123 fs.readFile/writeFile) | yes - panel keeps |
| **Container** | | | | | |
| control / inspect containers (docker) | admin-panel/src/app/actions/docker.ts:41 controlContainer(); :164 runCompose(); docker-ops.ts:18 pullLatestImages(); :49 rebuildImages() | — (host; not a Rust route) | container:control | none — docker daemon (docker.ts:33,139 exec docker) | yes - panel keeps |
| container restart config | admin-panel/src/app/actions/containerConfig.ts:73 updateContainerConfig(); :120 resetRestartCount(); :180 syncContainerConfigWithDocker(); :210 initializeContainerConfig() | — (host) | container:update | none — filesystem JSON + docker inspect (containerConfig.ts:99,135 writeFile; :186 exec) | yes - panel keeps |
| restart services / deploy server | admin-panel/src/app/actions/services.ts:82 restartServices(); :181 updateServer() | — (host) | service:restart / service:deploy | none — docker ps / compose (services.ts:134 exec) | yes - ops CLI (tools/cms-tui) |
| deploy contest stack | admin-panel/src/app/actions/deployActions.ts:25 deployContest() | — (host) | deployment:deploy | none — spawns compose via deploy-operations lib (deployActions.ts:37) | yes - ops CLI (tools/cms-tui) |
| service / wiring / exposure registry | admin-panel/src/app/actions/serviceWiring.ts:75,85,94,103,112,121,183 (save/remove/resync*); exposureApply.ts:59 saveExposureApplyAction() | — (host) | container:control | registry tables services/wirings/contest_exposures via lib/panel-actions/registry.ts + runConfigSync (serviceWiring.ts:190) — AMBIGUOUS mixed DB+host, see §8 | yes - panel keeps |
| **Security** | | | | | |
| WAF settings / apply / restart | admin-panel/src/app/actions/securityWaf.ts:146 saveWafSettings(); :181 applyWafSettings(); :211 restartWaf() | — (host) | waf:config / waf:control | none — filesystem config + docker (securityWaf.ts:89 exec docker inspect; :127 fs.writeFile) | yes - panel keeps |
| TLS certificate renewal | admin-panel/src/app/actions/securityTls.ts:97 requestCertificateRenewal() | — (host) | tls:renew | none — queue file + docker (securityTls.ts:47 exec docker inspect; :111 fs.writeFile) | yes - panel keeps |
| unban / unlock / clear login activity | admin-panel/src/app/actions/securityBlocks.ts:128 queueUnban(); :159 unlockLoginLockout(); :198 clearLoginActivity() | — (host) | ban:unban / lockout:unlock | none — host agent queue files (securityBlocks.ts:124 fs.writeFile) + security_blocks table | yes - panel keeps |
| **Audit** | | | | | |
| audit log append (system-wide) | (implicit: recordAudit() in ~29 action/service files, e.g. services/contests.ts:73) <br> (none — Python admin writes no AuditLog; PHASE0-INVENTORY.md:33-38) | — (system, append-only) | audit:create is RESERVED (permission-registry.ts:204) | audit_log (lib/audit.ts audit_log.create) | No |
| **Settings / infrastructure** | | | | | |
| assign admin groups | admin-panel/src/app/actions/adminPermissions.ts:64 setAdminGroups() | POST /admins/:id/groups | group:assign | admin_groups (actions/adminPermissions.ts admin_groups.createMany/deleteMany) | No |
| set / clear admin permission override | admin-panel/src/app/actions/adminPermissions.ts:157 setAdminOverride(); :185 clearAdminOverride() | PUT /admins/:id/overrides | override:set | admin_permission_overrides (actions/adminPermissions.ts upsert/delete) | No |
| create group | admin-panel/src/app/actions/groups.ts:49 createGroup() | POST /groups | group:create | groups, group_permissions (actions/groups.ts groups.create, group_permissions.createMany) | No |
| update group | admin-panel/src/app/actions/groups.ts:90 updateGroup() | PATCH /groups/:id | group:update | groups, group_permissions (actions/groups.ts groups.update) | No |
| delete group | admin-panel/src/app/actions/groups.ts:169 deleteGroup() | DELETE /groups/:id | group:delete | groups, group_permissions (actions/groups.ts groups.delete) | No |
| ranking appearance / credits | admin-panel/src/app/actions/rankingAppearance.ts:112 updateRankingAppearance(); :146 saveRankingCredits(); :171 submitRankingCredits() | PUT /ranking/appearance | ranking:appearance | ranking_settings (actions/rankingAppearance.ts ranking_settings.upsert); also writes credits.json — AMBIGUOUS, see §8 | No |
| shown ranking targets | admin-panel/src/app/actions/rankingConfig.ts:56 showTarget(); :68 endTarget(); :74 endTargets() | POST /ranking/targets | ranking:override | ranking_config (panel-actions/ranking-config.ts create/updateMany) | No |
| ranking override | admin-panel/src/app/actions/rankingOverrides.ts:79 saveRankingOverride(); :102 saveRankingOverrides(); :111 endRankingOverride(); :123 endRankingOverrides() | POST /ranking/overrides | ranking:override | ranking_overrides (panel-actions/ranking-overrides.ts create/updateMany) | No |
| monitor target CRUD | admin-panel/src/app/actions/monitor.ts:30 addMonitorTarget(); :67 updateMonitorTarget(); :102 removeMonitorTarget(); :126 toggleMonitorTarget() | POST /monitor/targets | monitor:create / monitor:update / monitor:delete | monitor_targets (actions/monitor.ts monitor_targets.create/update/delete) | No |
| backup schedule CRUD / settle run | admin-panel/src/app/actions/schedules.ts:139 createSchedule(); :175 updateSchedule(); :225 toggleSchedule(); :255 deleteSchedule(); :294 settleRun() | POST /backup/schedules | backup:schedule / backup:delete / backup:settle | backup_schedules, backup_runs (actions/schedules.ts; scheduler/runner.ts) — runner shells out to docker, see §8 | No |
| assign / move evaluation lane | admin-panel/src/app/actions/evaluationLanes.ts:42 assignEvaluationLane(); :80 moveEvaluationLane(); :118 setFinalOpen() | POST /submissions/:id/lane | evaluation:lane_assign / evaluation:lane_move / contest:update | submissions.lane (actions/evaluationLanes.ts:142 $executeRaw) — also RPC to EvaluationService; see §8 | No |
| security blocks ledger (waiver / exemption) | admin-panel/src/app/actions/securityPatching.ts:64 createPatchingWaiver(); :76 endPatchingWaiver(); :95 bulkWaiveUnreachable(); securityExemptions.ts:28 grantLoginExemption(); :56 revokeLoginExemption() | POST /security/waivers | patching:waive / lockout:exempt | security_waivers (panel-actions/patching-waivers.ts), security_blocks (security/block-ledger.ts) — also writes host queue files, see §8 | No |
| username policy / contestant group membership | (panel: API routes api/username-policies/route.ts:88 PUT; api/contestant-groups/* — no server actions) | PUT /username-policies | username:policy:update | username_policies, contestant_groups, contestant_group_memberships (api routes $executeRaw / prisma) | No |
| backup create / delete archive | admin-panel/src/app/actions/backupActions.ts:21 triggerManualBackup(); backups.ts:88 triggerSelectiveBackup(); :132 deleteArchive() | — (host) | backup:create / backup:delete | none — docker exec / archive files (backups.ts:69, backupActions.ts exec) | yes - ops CLI (tools/cms-tui) |
| restore preview / promote | admin-panel/src/app/actions/restore.ts:81 startPreview(); :197 deletePreview(); restore-apply.ts:164 promotePreview(); restore-apply-measure.ts / restore-preview-run.ts / restore-apply-lock.ts / restore-apply-resolve.ts / restore-apply-steps.ts / restore-apply-measure-privileges.ts | — (host) | backup:restore | none — docker exec + psql + filesystem (restore-apply.ts:99, restore-apply-lock.ts:79 spawn docker, restore-preview-run.ts:52 execFile docker) | yes - ops CLI (tools/cms-tui) |
| config.toml / appearance / notifications | admin-panel/src/app/actions/appearance.ts:47 updateConfigToml(); configTomlActions.ts:124 updateConfigTomlValues(); notifications.ts:71 saveDiscordNotificationSettings(); :200 sendTestDiscordAlert() | — (host) | appearance:update / env:update / monitor:test | none — filesystem config.toml (appearance.ts:71, configTomlActions.ts:135 fs.writeFile) | yes - panel keeps |

## 4. Host access - not API work

Operations shelling out to docker, the filesystem, systemd or SSH are **not**
Rust API work. The panel keeps the ones it already owns (container control,
WAF/TLS, config files, registry sync); the ops CLI `tools/cms-tui`
(`dev/migration/INVENTORY.md:163`) owns deploy, backups and restore. They are
rows in section 3 with `Host access? = yes`; the tables they touch are host
state, not database tables, so `Tables written` reads `none - ...`. Where an
operation also writes a DB table (registry, block ledger, backup schedules) it
is marked AMBIGUOUS in section 8. Counted separately at the end.

## 5. Appendix - read-only operations

Reads stay out of the table. Listed here (grouped by action file, with the
`():line` of each exported function) so the write count is honest. Panel reads:

- `admin-panel/src/app/actions/adminPermissions.ts` (3): getAdminAccess():30, listGroupsWithPermissions():226, listAdminsAccessSummary():239
- `admin-panel/src/app/actions/admins.ts` (2): getAdmins():79, revealAdminPassword():210
- `admin-panel/src/app/actions/announcements.ts` (1): getAnnouncements():10
- `admin-panel/src/app/actions/appearance.ts` (1): readConfigToml():18
- `admin-panel/src/app/actions/audit-export.ts` (1): exportAuditLog():30
- `admin-panel/src/app/actions/audit.ts` (4): getAuditLog():104, getDistinctEntities():210, getAuditEntry():226, getSubmissionHistory():288
- `admin-panel/src/app/actions/auth.ts` (2): getCaptchaState():109, getCurrentUser():244
- `admin-panel/src/app/actions/backupActions.ts` (1): listBackups():52
- `admin-panel/src/app/actions/backups.ts` (1): listArchives():121
- `admin-panel/src/app/actions/configTomlActions.ts` (3): readConfigTomlValues():87, readDatabaseProfiles():174, readActiveContestId():201
- `admin-panel/src/app/actions/containerConfig.ts` (1): getContainerConfig():40
- `admin-panel/src/app/actions/contestTeams.ts` (1): listContestRoster():55
- `admin-panel/src/app/actions/contests.ts` (6): getContests():11, getAvailableContests():63, getBoundContestId():67, getShardContestBindings():71, getContestEditData():83, getContestCountdown():89
- `admin-panel/src/app/actions/datasets.ts` (1): getDataset():13
- `admin-panel/src/app/actions/deployActions.ts` (3): settleDeployOperations():66, fetchActiveDeployOperation():77, getActiveDeployOperation():82
- `admin-panel/src/app/actions/docker.ts` (3): fetchContainerLogs():82, getContainerLogs():101, getContainerContestId():136
- `admin-panel/src/app/actions/groups.ts` (1): listGroups():227
- `admin-panel/src/app/actions/limitTargets.ts` (1): listLimitTargets():14
- `admin-panel/src/app/actions/monitor.ts` (2): getMonitorTargets():17, testMonitorTarget():157
- `admin-panel/src/app/actions/notifications.ts` (1): getDiscordNotificationSettings():44
- `admin-panel/src/app/actions/participation-reads.ts` (2): getParticipation():9, getParticipationDetails():23
- `admin-panel/src/app/actions/participations.ts` (2): revealParticipationPassword():173, getMessages():247
- `admin-panel/src/app/actions/questions.ts` (1): getQuestions():10
- `admin-panel/src/app/actions/ranking.ts` (7): getRanking():89, getRankingUsers():112, getRankingBoardContests():137, getRankingOverrideOptions():142, getRankingUserDetail():197, searchRankingTargets():412, getRankingImpact():431
- `admin-panel/src/app/actions/rankingAppearance.ts` (1): getRankingAppearance():65
- `admin-panel/src/app/actions/rankingConfig.ts` (2): getShownTargets():32, getShownTargetChoices():45
- `admin-panel/src/app/actions/rankingOverrides.ts` (1): getRankingOverrides():51
- `admin-panel/src/app/actions/related-reads.ts` (6): getSubmissionExecutables():13, getSubmissionFiles():21, getSubmissionToken():29, getParticipationUserTests():34, listPermissionTable():43, downloadSubmissionFiles():58
- `admin-panel/src/app/actions/restore-apply-resolve.ts` (1): resolvePreviewConflict():134
- `admin-panel/src/app/actions/restore-apply.ts` (2): validatePromote():39, getPromoteStatus():247
- `admin-panel/src/app/actions/restore.ts` (2): getPreviewTables():125, getSampleRows():168
- `admin-panel/src/app/actions/schedules.ts` (3): listSchedules():112, listBackupLocationOptions():125, listRuns():275
- `admin-panel/src/app/actions/search.ts` (1): searchAll():7
- `admin-panel/src/app/actions/securityBlocks.ts` (4): readBannedAddresses():88, readLoginLockouts():107, readLoginActivity():178, readCounterAttempts():191
- `admin-panel/src/app/actions/securityExemptions.ts` (1): readLoginExemptions():21
- `admin-panel/src/app/actions/securityPatching.ts` (2): readPatchingState():45, readPatchingFindingsPage():57
- `admin-panel/src/app/actions/securityTls.ts` (1): readTlsState():68
- `admin-panel/src/app/actions/securityWaf.ts` (1): readWafState():99
- `admin-panel/src/app/actions/serviceWiring.ts` (2): getRegistryAction():130, previewRegistryAction():154
- `admin-panel/src/app/actions/services.ts` (4): getDeploymentMode():25, analyzeContainerDependencies():39, analyzeRestartRequirements():44, getServiceStatus():130
- `admin-panel/src/app/actions/statements.ts` (3): getStatements():10, getAttachments():76, getFileByDigest():137
- `admin-panel/src/app/actions/stats.ts` (1): getServerStats():8
- `admin-panel/src/app/actions/submissions.ts` (5): previewBatchRecalculation():126, previewRecalculationByIds():568, previewCommentApplication():665, previewCommentApplicationByIds():671, getSubmissionFieldAccess():824
- `admin-panel/src/app/actions/tasks.ts` (4): getTasks():10, getTaskSettings():16, getTaskDatasets():22, getTaskDiagnostics():26
- `admin-panel/src/app/actions/teams.ts` (2): getTeamEditData():13, getTeams():17
- `admin-panel/src/app/actions/testcases.ts` (1): getTestcases():153
- `admin-panel/src/app/actions/users.ts` (4): getUserEditData():18, listUserIds():40, getUsers():50, revealUserPassword():89
- `admin-panel/src/app/actions/workerConfig.ts` (1): getWorkers():62
- `admin-panel/src/app/actions/workers.ts` (1): getWorkersLiveStatus():16

Python read-only handlers (GET methods, e.g. `handlers/contest.py:165,175,197`, 
`handlers/dataset.py:61,183,225,253,349,421,493,579`, `handlers/submission.py:50,79,94`)
and the session-only `LoginHandler`/`LogoutHandler` (`handlers/main.py:59,134`, 
excluded per `dev/PHASE0-INVENTORY.md:91-93`) are not admin-domain writes.

## 6. Six counts

Definitions: **panel action** = an `export async function` in a file whose
first line is `'use server'`. **Read** = classified by the section 9 classifier
(name or permission is list/read/get/preview/search/fetch/analyze/reveal/export/
download/show/validate/test). **Write** = every non-read panel action (database
write or host write). **Python mutating handler** = a POST/DELETE method in the
11 handler modules. **Collapsed write operation** = one row of section 3 with
`Host access? = No` (the Rust API surface). **Host-access operation** = one
section 3 row with `Host access? = yes` (not API work). **Read-only** = section
5 entries.

| # | Count | Value | Command |
|---|---|---|---|
| 1 | panel actions | **239** | `grep -rl "'use server'" admin-panel/src/app/actions --include='*.ts' | xargs grep -h '^export async function' | wc -l` |
| 2 | panel actions that write | **132** | `python3 classify.py | awk '$3=="WRITE"||$3=="HOST"{n++}END{print n}'` (= 239 - 107 reads) |
| 3 | Python mutating handlers | **55** | `grep -rnE '^\s*def (post|delete)\(' src/cms/server/admin/handlers/*.py | wc -l` |
| 4 | collapsed write operations | **62** | `sed -n '/^## 3/,/^## 4/p' dev/migration/API-SURFACE.md | grep -c '| No |'` |
| 5 | host-access operations | **12** | `sed -n '/^## 3/,/^## 4/p' dev/migration/API-SURFACE.md | grep -c '| yes'` |
| 6 | read-only ones | **107** | `python3 classify.py | grep -c ' READ$'` |

The section 3 table has 74 rows: 62 collapsed database-write operations (API
work) plus 12 host-access operations. `classify.py` is the section 9 classifier;
the two `grep -c` commands count the `Host access?` cells in section 3 directly.

## 7. Largest group and riskiest group

The largest group is the core multi-surface CRUD that both UIs already
perform - contest, task, dataset, testcase, user, team, participation and
submission (section 3: 11+7+7+3+6+4+4 = 42 of the 62 collapsed API operations).
These are low-risk individually because they collapse cleanly onto one Rust
route each with a single registry key, but they are where the two surfaces
disagree on semantics (`dev/PHASE0-INVENTORY.md:60-62`: no default dataset on
task create, no sibling renumber on task delete, active-dataset delete
divergence). The riskiest group is **submissions / rejudge** together with the
**settings/infrastructure** rows: recalculate/rejudge
(`actions/submissions.ts:293,537,574`) deletes `evaluations` and
`submission_results` rows and fires RPC to the EvaluationService, so a Rust
route owns both a multi-table transaction and an out-of-process side effect;
and the settings rows (ranking overrides, backup schedules, evaluation lanes,
security waivers, username policies) are the ones that blur into host access -
they write DB tables *and* config files or shell out, so mis-routing one either
double-writes host state or silently drops a permission gate. These are exactly
the rows flagged AMBIGUOUS in section 8.

## 8. Ambiguities and the three least-sure operations

Rows marked AMBIGUOUS in section 3, restated. These are the three operations
whose classification is least certain:

1. **activate / switch active contest** (`actions/contests.ts:75`). It calls
   `writeActiveContestId`, which writes `contests.is_active` via `$executeRaw`
   (`lib/active-contest.ts:19,23`) but also writes `config.toml`. It is a DB
   write with a host side effect; whether the Rust route or the panel owns the
   config write is unresolved. Python has no equivalent route.
2. **recalculate / rejudge submission(s)** (`actions/submissions.ts:293,537,574`).
   Deletes `evaluations`/`submission_results` rows (Prisma) and issues RPC to
   the EvaluationService; the Python admin has no rejudge handler at all. It is
   a DB write plus an out-of-process effect, so it is neither pure CRUD nor host
   shell-out; listed as API work with an explicit RPC caveat.
3. **service / wiring / exposure registry** (`serviceWiring.ts:75-183`, 
   `exposureApply.ts:59`). Saves via `lib/panel-actions/registry.ts` (Prisma
   writes to `services`, `wirings`, `contest_exposures`) *and* calls
   `runConfigSync()` (`serviceWiring.ts:190`) which touches the host. Listed as
   host access (panel keeps) with the DB tables noted; the split is unresolved.

Other flagged rows: ranking appearance writes `ranking_settings` (DB) and
`credits.json` (host); backup schedules write `backup_schedules` (DB) but their
runner shells out to docker; evaluation lanes write `submissions.lane` via
`$executeRaw` and RPC; security waivers/exemptions write `security_waivers` /
`security_blocks` (DB) and host queue files. `login`/`logout`
(`actions/auth.ts:198,239`) are session-cookie operations with no DB write and
sit in the write bucket by the classifier's name rule; they belong with the
Python session-only handlers, not the Rust API. A few appendix entries are
borderline reads: `settleDeployOperations` (`deployActions.ts:66`),
`resolvePreviewConflict` (`restore-apply-resolve.ts:134`) and `validatePromote`
(`restore-apply.ts:39`) apply/validate host restore state, and
`previewCommentApplication*` (`submissions.ts:665,671`) carry a
`submission:update` gate but only preview - the name rule keeps them in
section 5, so a reviewer should confirm before treating 107 as exact.

`manager:create`/`manager:delete`, user/team update/delete and batch/bulk user
paths exist only as panel **API routes** (`api/datasets/[id]/managers/route.ts`, 
`api/users/[id]/route.ts`, `api/users/bulk/route.ts`, `api/managers/[id]/route.ts`),
not as server actions; those routes are counted in section 1 (52) but are not
rows here except where they are the panel's only counterpart to a Python
handler (section 3 dataset/user rows marked `Python-only`/`no server action`).

## 9. Reproducing the counts (`classify.py`)

`classify.py` (run from the repo root) emits one TSV row per panel server action
as `file:line name CLASS`; counts 2 and 6 in section 6 are `awk`/`grep` over it.
It encodes the read/write/host rules stated in section 6 and the host-file set
verified from `exec`/`spawn`/`fs.writeFile` call sites. It is documentation, not
source code; no runtime file is added.

```python
import re, glob, os
ACTIONS='admin-panel/src/app/actions'
READ_NAME=re.compile(r'^(get|list|read|search|preview|fetch|analyze|reveal|export|download|show|validate|test|describe|toSafe|parse|extract|groupBy|live|advisory|lines|resolvePreview)')
WRITE_OVERRIDE={'showTarget','showTargets','endTarget','endTargets','setFinalOpen'}
HOST_FILES={'appearance.ts','backupActions.ts','backups.ts','configTomlActions.ts',
 'containerConfig.ts','docker-ops.ts','docker.ts','restore.ts','restore-apply.ts',
 'restore-apply-resolve.ts','restore-apply-measure.ts','restore-apply-measure-privileges.ts',
 'restore-apply-lock.ts','restore-apply-steps.ts','restore-preview-run.ts',
 'securityBlocks.ts','securityTls.ts','securityWaf.ts','services.ts','serviceWiring.ts',
 'workerConfig.ts','deployActions.ts','exposureApply.ts','notifications.ts'}
READ_VERBS={'list','read','download','reveal'}
for f in sorted(glob.glob(ACTIONS+'/*.ts')):
    txt=open(f).read()
    if not re.search(r"'use server'|\"use server\"",txt): continue
    lines=txt.split('\n')
    starts=[(i,m) for i,l in enumerate(lines) for m in [re.match(r'export async function (\w+)',l)] if m]
    for idx,(i,m) in enumerate(starts):
        name=m.group(1); end=starts[idx+1][0] if idx+1<len(starts) else len(lines)
        body='\n'.join(lines[i:end])
        perms=re.findall(r"(?:ensurePermission|requirePermission)\('([a-z_:]+)'\)",body)
        read_by_perm=bool(perms) and all(p.split(':')[-1] in READ_VERBS or p=='all:all' for p in perms)
        read=(name not in WRITE_OVERRIDE) and (bool(READ_NAME.match(name)) or read_by_perm)
        cls='READ' if read else ('HOST' if os.path.basename(f) in HOST_FILES else 'WRITE')
        print(f'{os.path.basename(f)}:{i+1} {name} {cls}')
```

Sources re-counted: `dev/PHASE0-INVENTORY.md`, `dev/migration/INVENTORY.md`,
`admin-panel/src/app/actions/**/*.ts`, `admin-panel/src/app/api/**/route.ts`,
`admin-panel/src/lib/permission-registry.ts`, `admin-panel/src/lib/permission-engine.ts`,
`src/cms/server/admin/handlers/__init__.py`, `src/cms/server/admin/handlers/*.py`,
`src/cms/db/permissions.py`. No code or schema was changed.
