# S-5 gap: what of `cms.grading` already exists in Rust

Measured at `04db7ec8` (`feat/rust-trunk-reconcile`), worktree `feat/rust-S5-gap`.
Python side: every `.py` under `src/cms/grading/` — 43 files, 8,452 lines (`wc -l`).
Rust side: every `.rs` under `backend/cms-worker/src/` — 49 files, 7,611 lines, plus the
job/result codecs in `backend/cms-proto/src/jobs/` and the write shapes in
`backend/cms-db/src/writes/`.

The plan's S-5 entry reads as if none of `cms.grading` existed in Rust. It does: **643 lines
are ported, 5,598 are partial, 2,211 are absent**, and the remaining behaviour to port is
about **3,357 lines**, not 8,452. A blind port on top of `cms-worker` would duplicate the
5,598 lines that are already there.

A row says `ported` only when the behaviour, not the name, is present. Rust is snake_case and
Python is PascalCase, so every row below was read on both sides; the citation is the function
that proves it.

---

## 1. The counts

| State | Modules | Lines |
|---|---|---|
| `ported` | 5 | 643 |
| `partial` | 16 | 5,598 |
| `absent` | 22 | 2,211 |
| **total** | **43** | **8,452** |

The 22 absent modules are almost entirely two tables: the 13 languages (886 lines, plus the
17-line package header, `language.py` and `languagemanager.py` = 1,194) and `scoretypes/` +
`scoring.py` (1,197).
Neither is scaffolding that can be skipped — one is every compiler command line, the other is
every score a contestant sees.

---

## 2. Per-module table

`none` means the name and the behaviour were both searched for and neither is there. Where a
Rust path is given, the line is the function that carries the behaviour. Rust paths with no
crate prefix are under `backend/cms-worker/src/`; Python paths with no directory are under
`src/cms/grading/`.

| Module | Rust counterpart | State | Evidence | Gap |
|---|---|---|---|---|
| `src/cms/grading/__init__.py` (87) | `backend/cms-worker/src/edge/tombstone.rs:32` (error type); none for status text | partial | `JobException` `src/cms/grading/__init__.py:43` ↔ `JobError` `backend/cms-worker/src/edge/tombstone.rs:32`; `format_status_text` `:57` ↔ none | `format_status_text` — printf arguments plus locale — has no Rust equivalent; it is still the Python server's and `cmstaskenv`'s display step. |
| `Job.py` (793) | `backend/cms-worker/src/job/mod.rs:138`, `job/compilation.rs:59`, `job/evaluation.rs:94`, `job/user_test.rs:40`, `job/user_test.rs:118`, `backend/cms-proto/src/jobs/job.rs:17` | partial | `CompilationJob.from_submission` `Job.py:354` ↔ `CompilationJob::from_submission` `job/compilation.rs:59` | Missing the `from_operation` dispatch (`Job.py:230`), the four result applications `to_submission`/`to_user_test` (`:389`, `:481`, `:652`, `:738`), `export_to_dict` (`:167`), `get_sandbox_digest_list` (`:272`), and `_is_contest_multithreaded` (`:59`, a flag the caller must now set). |
| `languagemanager.py` (111) | none | absent | `get_language` `languagemanager.py:42` ↔ none; no `LANGUAGES` table exists, only the `Language` value at `backend/cms-worker/src/job/mod.rs:163` | No name→language lookup, no `filename_to_language`, no `safe_get_lang_filename`; the 13-module plugin scan (`:96`) has no counterpart. |
| `language.py` (180) | `backend/cms-worker/src/tasktypes/mod.rs:84` | partial | `Language.get_compilation_commands` `language.py:110` ↔ `Toolchain::compilation_commands` `backend/cms-worker/src/tasktypes/mod.rs:102` | Only the interface. `CompiledLanguage`'s default evaluation command (`language.py:176`), the extension defaults and the multithreading flag have no implementation. |
| `languages/__init__.py` (17) | none | absent | the file is a licence header with no code (`:1-17`) ↔ none | No behaviour to port; the registration role it nominally has is `languagemanager._load_languages` (`:96`), which is also absent. |
| `languages/c11_gcc.py` (64) | none | absent | `C11Gcc.get_compilation_commands` `:53` ↔ none; the only `impl Toolchain` in the tree is the test stub `backend/cms-worker/tests/tasktypes_helpers.rs:47` | The whole `C11 / gcc` command line (`/usr/bin/gcc -DEVAL -std=gnu11 …`) is missing. |
| `languages/cpp11_gpp.py` (63) | none | absent | `Cpp11Gpp.get_compilation_commands` `:53` ↔ none | The `C++11 / g++` command line is missing. |
| `languages/cpp14_gpp.py` (64) | none | absent | `Cpp14Gpp.get_compilation_commands` `:54` ↔ none | The `C++14 / g++` command line is missing. |
| `languages/cpp17_gpp.py` (64) | none | absent | `Cpp17Gpp.get_compilation_commands` `:54` ↔ none | The `C++17 / g++` command line is missing. |
| `languages/cpp20_gpp.py` (63) | none | absent | `Cpp20Gpp.get_compilation_commands` `:53` ↔ none | The `C++20 / g++` command line is missing. |
| `languages/csharp_mono.py` (69) | none | absent | `CSharpMono.get_compilation_commands` `:56` ↔ none | The `C# / Mono` compile and run commands (`:66`) are missing. |
| `languages/haskell_ghc.py` (70) | none | absent | `HaskellGhc.get_compilation_commands` `:50` ↔ none | The `Haskell / ghc` command line is missing. |
| `languages/java_jdk.py` (93) | none | absent | `JavaJDK.get_compilation_commands` `:60` ↔ none | The `Java / JDK` compile and run commands (`:80`, including the `.jar`/`.zip` choice) are missing. |
| `languages/pascal_fpc.py` (62) | none | absent | `PascalFpc.get_compilation_commands` `:53` ↔ none | The `Pascal / fpc` command line is missing. |
| `languages/php.py` (62) | none | absent | `Php.get_compilation_commands` `:48` ↔ none | The `PHP` compile and run commands (`:58`) are missing. |
| `languages/python3_cpython.py` (81) | none | absent | `Python3CPython.get_compilation_commands` `:54` ↔ none | The `Python 3 / CPython` compile and run commands (`:77`) are missing. |
| `languages/python3_pypy.py` (81) | none | absent | `Python3PyPy.get_compilation_commands` `:54` ↔ none | The `Python 3 / PyPy` compile and run commands (`:77`) are missing. |
| `languages/rust.py` (50) | none | absent | `Rust.get_compilation_commands` `:43` ↔ none | The `Rust` command line is missing. |
| `ParameterTypes.py` (237) | `backend/cms-worker/src/tasktypes/batch.rs:154`, `admin-panel/src/lib/tasktype-params.ts:65` | partial | `ParameterTypeChoice.validate` `ParameterTypes.py:177` ↔ `validateTaskTypeParams` `admin-panel/src/lib/tasktype-params.ts:65` | The validation half is re-implemented in the panel, not the worker: `Batch::new` (`tasktypes/batch.rs:154`) checks shape only and treats any value other than `grader` as `alone`, so a typo the Python constructor rejects is accepted. `ParameterTypeInt` has no counterpart except Communication's inline count check (`tasktypes/communication/mod.rs:98`). |
| `Sandbox.py` (1,539) | `backend/cms-worker/src/sandbox/mod.rs:159`, `sandbox/launch.rs:59`, `sandbox/options.rs:81`, `sandbox/exits.rs:79`, `backend/cms-worker/src/stage/files.rs:80` | partial | `IsolateSandbox.build_box_options` `Sandbox.py:1132` ↔ `Options::arguments` `sandbox/options/flags.rs:80`; `create_file` `Sandbox.py:340` ↔ `Stage::create` `stage/files.rs:80` | No file API on the sandbox at all (it moved to `stage/`); no `allow_writing_only` (`Sandbox.py:1046`); no `--init`/`--cleanup` lifecycle (`:1490`, `:1499`); no per-worker box-id allocation (`:920`); no `StupidSandbox`; exit code 2 is refused (`exits.rs:93`) where Python returns `False` (`:1484`). |
| `scoretypes/abc.py` (525) | none | absent | `ScoreTypeGroup.compute_score` `scoretypes/abc.py:403` ↔ none; the score columns are only stored, `backend/cms-db/src/writes/shapes.rs:164` | No aggregation, no subtask grouping, no public or ranking details, no feedback-mode logic (`:425-474`). |
| `scoretypes/GroupMin.py` (48) | none | absent | `GroupMin.reduce` `:46` ↔ none | No minimum-over-group reduction. |
| `scoretypes/GroupMul.py` (50) | none | absent | `GroupMul.reduce` `:48` ↔ none | No product-over-group reduction. |
| `scoretypes/GroupThreshold.py` (55) | none | absent | `GroupThreshold.reduce` `:49` ↔ none | No threshold reduction. |
| `scoretypes/__init__.py` (66) | none | absent | `get_score_type` `:48` ↔ none | No score-type registry or constructor. |
| `scoretypes/Sum.py` (162) | none | absent | `Sum.compute_score` `:115` ↔ none | No per-testcase sum, and no HTML detail template (`:62-104`). |
| `scoring.py` (291) | none | absent | `task_score` `scoring.py:106` ↔ none | No score modes (`max`, `max_subtask`, `max_tokened_last`, `:172-179`) and no dataset-change delta (`compute_changes_for_dataset`, `:47`). |
| `steps/compilation.py` (155) | `backend/cms-worker/src/tasktypes/compile.rs:156` | ported | `compilation_step` `steps/compilation.py:68` ↔ `compile_with` `tasktypes/compile.rs:156` and `decide` `:220` | — |
| `steps/evaluation.py` (299) | `backend/cms-worker/src/tasktypes/evaluate.rs:150`, `:186`, `:208` | partial | `evaluation_step_after_run` `steps/evaluation.py:224` ↔ `decide` `tasktypes/evaluate.rs:186`; `human_evaluation_message` `:263` ↔ `what_went_wrong` `:208` | The `writable_files` confinement (`steps/evaluation.py:215` → `Sandbox.py:1046`) has no counterpart; `dirs_map` (`:210`) is not a parameter of the Rust step — each task type maps its own directories. |
| `steps/__init__.py` (47) | `backend/cms-worker/src/steps/mod.rs:31` | ported | `from .trusted import checker_step …` `steps/__init__.py:27` ↔ `pub use checker::{…}` `steps/mod.rs:33` | — |
| `steps/messages.py` (83) | `backend/cms-worker/src/steps/mod.rs:41` | partial | `EVALUATION_MESSAGES` `steps/evaluation.py:45` ↔ `StockMessage` `steps/mod.rs:41` | Only the three stock sentences exist. `help_text` and the two message collections are inlined as constants in `compile.rs:38` and `evaluate.rs:42`, so there is no single table an admin help page can read. |
| `steps/stats.py` (157) | `backend/cms-worker/src/stats.rs:52`, `:82`, `backend/cms-worker/src/measure.rs:60` | ported | `execution_stats` `steps/stats.py:47` ↔ `ExecutionStats::of` `stats.rs:52`; `merge_execution_stats` `:79` ↔ `merged_with` `:82` | — |
| `steps/trusted.py` (282) | `backend/cms-worker/src/steps/checker.rs:177`, `:52`, `:103` | partial | `extract_outcome_and_text` `steps/trusted.py:80` ↔ `extract_verdict` `steps/checker.rs:177` | No `checker_step` (`:210`): nothing creates the checker's box, stages input/correct/user output, refuses a file already present, or launches the checker. The pieces are pure and unwired. |
| `steps/utils.py` (111) | `backend/cms-worker/src/tasktypes/compile.rs:156` | ported | `generic_step` `steps/utils.py:72` ↔ `compile_with` `tasktypes/compile.rs:156` | — |
| `steps/whitediff.py` (173) | `backend/cms-worker/src/steps/white_diff.rs:112`, `:202` | ported | `white_diff_fobj_step` `steps/whitediff.py:128` ↔ `Comparison::of` `steps/white_diff.rs:202` | — |
| `tasktypes/abc.py` (242) | `backend/cms-worker/src/tasktypes/mod.rs:84`, `backend/cms-worker/src/job/mod.rs:196` | partial | `TaskType.execute_job` `tasktypes/abc.py:231` ↔ none; `get_auto_managers` `:180` ↔ `Dataset.auto_managers` `job/mod.rs:196` | No task-type dispatch, and no `name`/`testable`/`ALLOW_PARTIAL_SUBMISSION` metadata; parameter validation is each type's own `new` (`tasktypes/batch.rs:154`). |
| `tasktypes/BatchAndOutput.py` (158) | `backend/cms-worker/src/tasktypes/batch_and_output.rs:163` | partial | `BatchAndOutput.evaluate` `:124` ↔ `BatchAndOutput::evaluate` `batch_and_output.rs:163` | The answer is decided and handed on but never compared: `eval_output` (`tasktypes/util.py:216`) has no counterpart, so `outcome` stays `None` for a carried or written answer. |
| `tasktypes/Batch.py` (397) | `backend/cms-worker/src/tasktypes/batch.rs:154`, `tasktypes/compile.rs:72`, `tasktypes/evaluate.rs:90` | partial | `Batch.evaluate` `:388` ↔ `Batch::evaluate` `evaluate.rs:90`; `_do_compile` `:199` ↔ `Batch::compile` `compile.rs:72` | `_evaluate_step`'s comparison (`Batch.py:366-386`) is missing, so a Batch answer never becomes a score. |
| `tasktypes/Communication.py` (444) | `backend/cms-worker/src/tasktypes/communication/mod.rs:136` | partial | `Communication.evaluate` `:247` ↔ `Communication::evaluate` `communication/mod.rs:136` | `compile` (`Communication.py:184`) is absent, so a Communication submission cannot be built. The manager's memory bound and the configured floor on its time limit (`:318-324`) are also not applied (`communication/mod.rs:19-24` says so). |
| `tasktypes/__init__.py` (73) | `backend/cms-worker/src/edge/tombstone.rs:101` | partial | `get_task_type` `:57` ↔ `resolve_task_type` `edge/tombstone.rs:101` | A name resolves against the configured list, but nothing turns a name plus parameters into a task-type value; there is no registry of the five. |
| `tasktypes/OutputOnly.py` (138) | `backend/cms-worker/src/tasktypes/output_only.rs:118` | partial | `OutputOnly.evaluate` `:113` ↔ `OutputOnly::evaluate` `output_only.rs:118` | The carried answer is handed on unjudged; `eval_output` (`:127`) is missing. |
| `tasktypes/TwoSteps.py` (352) | `backend/cms-worker/src/tasktypes/two_steps/mod.rs:136` | partial | `TwoSteps.evaluate` `:215` ↔ `TwoSteps::evaluate` `two_steps/mod.rs:136` | `compile` (`:141`) is absent — manager source, manager header, the two user files and their headers, executable named `manager` — and the final comparison (`:337`) is missing. |
| `tasktypes/util.py` (294) | `backend/cms-worker/src/tasktypes/mod.rs:174`, `:222`, `backend/cms-worker/src/tasktypes/evaluate.rs:120` | partial | `check_executables_number` `:144` ↔ `only_executable` `evaluate.rs:120`; `eval_output` `:216` ↔ none | No `eval_output` (the checker-or-white-diff dispatch). `delete_sandbox`'s archive-on-request (`:72-100`) is only a keep flag in `Run::close` (`tasktypes/mod.rs:222`): `Sandbox::archive` (`sandbox/archive.rs:86`) is never called outside tests, so an `archive_sandbox` job keeps a directory and stores no digest. |

---

## 3. What the numbers mean

`wc -l` counts comments and doc comments, and this codebase comments heavily: `cms-worker` is
7,611 lines in total, against 5,598 Python lines that are "partial". Line counts are the
plan's own unit, not a measure of how much work is left; the behaviour is.

The 5,598 partial lines are mostly in Rust already and are waiting for three things: a
language table to hand `Toolchain` in, a judge to turn an answer into an outcome, and an
executor to call any of it. `cms-worker` has no binary: `backend/cms-worker/Cargo.toml` declares
none, `Dockerfile:26` builds only `cms-log-service` and `cms-resource-service`, and compose
still runs `cmsWorker` (`docker-compose.yml:835`). The Rust worker is a library with tests, not
a service that has ever graded a submission.

---

## 4. Structural differences

These are decisions, not defects. Each is named with the choice it forces.

### 4.1 `Sandbox.py` (1,539) vs `sandbox/` + `stage/`

The Rust sandbox is a launch-and-read wrapper: `Sandbox::run` (`sandbox/mod.rs:159`) hands a
command to `isolate`, drains both pipes, and reads `--meta`; `Sandbox::start`/`Launch::wait`
(`sandbox/launch.rs:99`, `:59`) do the same for two runs that must be alive together;
`Options` (`sandbox/options.rs:81`) is the flag set; `exits::Outcome` (`sandbox/exits.rs:79`)
reads the code `isolate` returned. There is no `create_file`, `get_file`, `get_file_to_string`,
`stat_file`, `file_exists`, `remove_file`, `cleanup`, `relative_path` or
`translate_box_exitcode` on it — a grep for those names under `backend/cms-worker/src/sandbox/`
returns nothing.

Which operations happen elsewhere, and which never happen:

| Python operation | Where it is in the Rust path |
|---|---|
| `create_file` (`Sandbox.py:340`) | `Stage::create` (`stage/files.rs:80`) — exclusive create, mode set after creation |
| `create_file_from_string` (`:382`) | `Stage::write` (`stage/files.rs:104`) |
| `create_file_from_storage` (`:369`) | `Stage::write_from_storage` (`stage/files.rs:124`) |
| `get_file` / `get_file_to_string` (`:395`, `:432`) | `Stage::read` with an optional limit (`stage/files.rs:142`) |
| `get_file_to_storage` (`:449`) | `Stage::store` (`stage/files.rs:165`) |
| `relative_path` (`:329`, `:1093`) | `Stage::path` (`stage/files.rs:69`) |
| `file_exists` (`:475`) | `Stage::path(..).is_file()` at the call site (`tasktypes/evaluate.rs:230`) |
| `stat_file` (`:465`), `remove_file` (`:485`), `get_file_text` (`:412`) | never performed; no caller needs them |
| `cleanup` / `initialize_isolate` (`:1499`, `:1490`) | never performed; each `Sandbox::new` makes a fresh directory (`sandbox/spawn.rs:72`) and `Run::close` removes it (`tasktypes/mod.rs:222`) |
| `allow_writing_all/none/only` (`:1030`, `:1038`, `:1046`) | never performed — see below |
| `translate_box_exitcode` (`:1469`) | `Outcome::of` (`sandbox/exits.rs:93`) |

Three behavioural consequences, stated rather than judged:

- **Write confinement is gone.** Python's evaluation remounts the home read-only and opens only
  the files a run may write (`Sandbox.py:1046-1083`, called from
  `steps/evaluation.py:215`). Rust binds the home `rw` for the run's whole life
  (`Options::for_sandbox`, `sandbox/options.rs:159-168`; no `ro` rule anywhere). A run can
  rename or replace its own input and executable.
- **Exit code 2 changed meaning.** Python maps `0`/`1` to `True` and `2` to `False`, and raises
  on anything else (`Sandbox.py:1482-1488`), so a sandbox error becomes a failed job that is
  reported. Rust accepts only `0`/`1` and refuses `2` (`sandbox/exits.rs:93-98`), so the same
  event becomes a `SpawnError` that fails the whole group.
- **Box ids are not allocated.** Python assigns each worker a band of `isolate` box ids
  (`Sandbox.py:913-925`). Rust leaves `box_id` at its default `0` (`sandbox/options.rs:130`),
  so two workers on one host would contend for box 0. That is safe only if one worker is one
  host.

The two-backend abstraction: `StupidSandbox` (`Sandbox.py:563`) exists so the same grading code
runs locally without `isolate`. That is *why* the file API lives on the sandbox: both backends
must expose it. Rust has one backend and moved the file API to `stage/`, which is coherent. The
decision this forces: **does the Rust worker need a non-`isolate` backend at all** — for local
runs, `cmsMake`, and `cmstaskenv` — or is the second backend deleted and those flows served by
`Stage` over a real directory with no isolation? If the latter, `Sandbox.py`'s abstraction has
no role in a worker that stages its own files; if the former, `stage/` has to be parameterised
by the same backend choice, because a `StupidSandbox` would not run inside `isolate` at all.

### 4.2 `scoretypes/` (906) and `scoring.py` (291): where the score is computed today

Zero Rust counterpart. `grep -rn 'ScoreType\|score_type\|GroupMin\|GroupThreshold\|GroupMul'
backend/` returns only the `score_type` column in the schema and its fixtures, never a
computation.

Scoring was checked three places before being called absent:

- **the worker** computes a per-testcase outcome (`0.0`/`1.0`, or a checker's float) but never
  aggregates it: `Batch::evaluate` returns `outcome: Option<f64>` (`tasktypes/evaluate.rs:61`),
  and the only aggregation in the crate is `ExecutionStats` (time and memory, not points);
- **`cms-db`** only stores and reads the columns: `ScoreRow`
  (`backend/cms-db/src/writes/shapes.rs:164`) and `INSERT … submission_results` on the score
  columns (`backend/cms-db/src/writes/statements.rs:47-57`), plus reads in
  `backend/cms-db/src/submission/result.rs:27-36`;
- **the panel and the ranking site** display what is stored: `ranking-web/src/score_events.rs`
  diffs the per-pair scores it is handed (it never computes one); and
  `admin-panel/src/components/tasks/DatasetScoreSubtaskRow.tsx:47` renders a `GroupThreshold`
  dataset without scoring anything.

The score a contestant sees is computed by the **Python** `ScoringService`:
`src/cms/service/ScoringService.py:102` calls `score_type.compute_score(submission_result)` and
writes all five columns. The per-task score a task page shows is `task_score` at
`scoring.py:106`, still called from the Python contest and admin handlers
(`src/cms/server/contest/handlers/tasksubmission.py:52`,
`src/cms/server/admin/handlers/contestranking.py:36`). Compose still runs `cmsScoringService`
(`docker-compose.yml:247-282`).

Decision this forces: **where the score types live.** Three plausible homes, with different
consequences: (a) a Rust `cms-scoring` service replacing `ScoringService` (S-6 already lists
it) — keeps the worker out of the database write path; (b) inside `cms-worker`, so a job
carries `score_details` home — removes a service but makes every worker write result rows;
(c) leave it Python until S-6 — cheapest now, but S-7's "submit → score → ranking" gate cannot
pass with the scoring step still in Python. The 906 lines are pure functions over an evaluated
result, so they port cleanly anywhere; the decision is about the write path, not the code.

### 4.3 The thirteen languages (903) and `language.py` / `languagemanager.py`

No `languages/` module exists in Rust. The seam is cut but empty: `Toolchain`
(`tasktypes/mod.rs:84`) declares `source_extension`, `executable_extension`,
`compiles_against`, `compilation_commands` and `evaluation_commands`; every task type takes a
`&dyn Toolchain`. The only implementation in the repository is a test stub
(`backend/cms-worker/tests/tasktypes_helpers.rs:47`).

So the command lines are neither ported nor inlined: they are **supplied by a caller that does
not exist**. `Batch::compile` asks `toolchain.compilation_commands(&inputs.sources, &executable)`
(`tasktypes/compile.rs:87`) and `Batch::evaluate` asks
`toolchain.evaluation_commands(...)` (`tasktypes/evaluate.rs:99`), but `cms-worker` has no
binary, no configuration and no `get_language`. There is no table anywhere in `backend/` that
names `gcc`, `g++`, `ghc`, `mono`, `fpc`, `javac` or `pypy`; the only occurrences are test
fixtures and the `C++20 / g++` string in a database fixture
(`backend/cms-db/tests/support/contest_fixture.rs:41`).

The table also carries more than commands: `source_extensions` (a list — contestants may submit
`.cpp` or `.cc`), `header_extensions`, `object_extensions`, `executable_extension`,
`requires_multithreading`, and per-language evaluation overrides (`JavaJDK` runs a jar,
`CSharpMono` an `.exe`, `Php` an interpreter). Rust's `Toolchain` carries one source extension
and one executable extension; `compiles_against` is the only place the header/object lists can
live. That is a narrower interface than the data, so porting the table is not a mechanical
fill-in of 13 `impl` blocks — the trait needs the plural extension lists first.

Decision this forces: **whether the language table is configuration or code.** Python makes it
plugin code (`languagemanager._load_languages`, `:96`). Rust can either compile 13 `impl
Toolchain` types (simple, but a new language is a rebuild) or load a table from configuration
(the operator can add a compiler, but the trait's methods become data). The plan has no answer.

### 4.4 The remaining seven modules

| Module | State | Evidence | What is actually missing |
|---|---|---|---|
| `ParameterTypes.py` (237) | partial | `ParameterTypeChoice.validate` `:177` ↔ `validateTaskTypeParams` `admin-panel/src/lib/tasktype-params.ts:65` | The worker has no `ParameterType` abstraction and no choice-membership check; `Batch::new` accepts any third value (`tasktypes/batch.rs:154`). The form-rendering half is the panel's (`dataset-tasktype-params.ts`), not the worker's. |
| `tasktypes/util.py` (294) | partial | `check_executables_number` `:144` ↔ `only_executable` `tasktypes/evaluate.rs:120`; `eval_output` `:216` ↔ none | `eval_output` is the missing one — the checker-or-white-diff dispatch every non-Communication task type ends with. `create_sandbox`/`delete_sandbox` became `Runtime::open`/`Run::close`, and the archive half of `delete_sandbox` (`:85-88`) did not come with it. |
| `steps/trusted.py` (282) | partial | `extract_outcome_and_text` `:80` ↔ `extract_verdict` `steps/checker.rs:177`; `checker_step` `:210` ↔ none | The pure half is ported (verdict extraction, `TrustedLimits`, `judge_trusted_run`). The orchestration is not: nothing stages `input.txt`, `correct_output.txt`, `checker` and the user answer, guards against a file already present, or launches the checker. |
| `steps/messages.py` (83) | partial | `EVALUATION_MESSAGES` `steps/evaluation.py:45` ↔ `StockMessage` `steps/mod.rs:41` | Only `success`/`partial`/`wrong`; the compilation and evaluation collections (with `help_text` for the help page) are inlined as string constants (`compile.rs:38-41`, `evaluate.rs:42-48`). |
| `steps/utils.py` (111) | ported | `generic_step` `:72` ↔ `compile_with` `tasktypes/compile.rs:156` | Nothing, but there is no general helper: each phase (`compile_with`, the two-steps and communication launch loops) re-implements the sequential-run-and-merge. |
| `scoring.py` (291) | absent | `task_score` `:106` ↔ none | The three score modes and the dataset-change delta. Note this is a **server/ranking** concern sitting inside `cms.grading`; it is not needed by the worker at all. |
| `Job.py` (793) | partial | `CompilationJob.from_submission` `:354` ↔ `job/compilation.rs:59` | Construction is ported for all four paths. Application is not: no dispatcher, no `to_submission`/`to_user_test`, no `export_to_dict`, no digest list, and `_is_contest_multithreaded` is now the caller's flag. |

---

## 5. Proposed epic sequence

Dependency order. "Lines" counts the Python behaviour still missing, measured on the function
ranges in this document; it is not the module size. The sum is 3,357 of the 8,452; the other
4,452 are already in Rust and only need exercising (plus the 643 ported).

| # | Epic | Closes | Lines | Depends on |
|---|---|---|---|---|
| S-5a | **The judge.** Port `eval_output` (`tasktypes/util.py:216`) and wire it into `Batch`, `BatchAndOutput`, `OutputOnly` and `TwoSteps` evaluation tails, so a written or carried answer becomes `outcome`/`text`/`admin_text`. Includes `checker_step` orchestration (`steps/trusted.py:210`) and the "file already in the box" guard. | `Batch.py`, `BatchAndOutput.py`, `OutputOnly.py`, `TwoSteps.py`, `tasktypes/util.py`, `steps/trusted.py` | 147 + 73 = **220** | nothing (uses `steps/white_diff.rs`, `steps/checker.rs`) |
| S-5b | **The language table.** Widen `Toolchain` to plural source/header/object extensions, implement the 13 languages, and add a registry plus `get_language`/`filename_to_language`. | `languages/*` (13), `languages/__init__.py`, `language.py`, `languagemanager.py` | **1,194** | nothing |
| S-5c | **The two missing compile phases.** `Communication.compile` (stub + user sources + executable named after the codenames) and `TwoSteps.compile` (manager + manager header + user sources + their headers + executable `manager`). | the compile halves of `Communication.py` and `TwoSteps.py` | **135** | S-5b (needs real command lines) |
| S-5d | **Score types and task score.** `scoretypes/` (6 modules) and `scoring.py`, in whichever home 4.2 decides; includes the dataset-change delta. | `scoretypes/*`, `scoring.py` | **1,197** | S-5a (needs an outcome to aggregate) |
| S-5e | **The executor and a binary.** `Job.from_operation` dispatch, job-body → typed job, task-type construction from name + parameters, result `export_to_dict`, `to_submission`/`to_user_test` against the existing `ResultRow`/`EvaluationRow`/`ScoreRow` shapes, `get_sandbox_digest_list`, and a `cms-worker` binary speaking `execute_job_group`. | `Job.py` (remainder), `tasktypes/__init__.py`, `tasktypes/abc.py`, `Worker.py`'s loop | **340 + 60** | S-5a, S-5b, S-5c, S-5d |
| S-5f | **Sandbox confinement and lifecycle.** Per-file write confinement (`allow_writing_only`), `--init`/`--cleanup`, box-id allocation, and the exit-code-2 semantics; decide `StupidSandbox`. | the non-launch half of `Sandbox.py` | **~150** (+318 if `StupidSandbox` is kept) | before any production use; independent of the rest |
| S-5g | **Parameter and message parity.** Choice-membership validation in the worker (or a written decision that the panel is the only validator), and a single message table with `help_text`. | the validation half of `ParameterTypes.py`, the collection half of `steps/messages.py`, `format_status_text` in `__init__.py` | **~61** | S-5e (needs a task-type constructor to validate in) |

Ordering that is not arbitrary:

- **S-5a before S-5d and S-5e.** A score type aggregates outcomes; without the judge, every
  `outcome` is `None` and S-5d has nothing to test against. This is also the cheapest epic
  (220 lines) and it closes four task types at once, so it should be the first dispatch.
- **S-5b before S-5c.** The two compile phases are written against a `Toolchain`; with only a
  test stub they would be tested against hand-written commands, which is what the failure this
  document exists to prevent looks like.
- **S-5e last of the functional epics.** It is the one that turns the library into a service,
  and doing it early would expose a worker whose only working task type is `Batch` compile.
- **S-5f before production, not before S-5e.** It is independent and security-bearing; a
  worker that grades with no write confinement should not run a real contest, but it can be
  developed and tested first.

S-5a plus S-5b (1,414 lines) is enough for one real `Batch` submission to compile and score
end to end in a test; S-5e is what makes it a service. If the next dispatch is one epic, it is
S-5a.

---

## 6. What could not be classified, and limits of this measurement

- **Nothing is unclassified.** All 43 modules have a state and a citation on both sides, or an
  explicit `none`.
- `languages/__init__.py` (17) is a licence header with no code. It is counted `absent` because
  there is no behaviour to port; its nominal registration role belongs to `languagemanager`.
- Line counts are `wc -l`, including comments and doc comments. They are the plan's own unit
  (its S-5 line says 8,452), which is why they are used here rather than code-only counts.
- The "lines remaining" figures for S-5f, S-5g and S-5e are measured on function ranges, not
  on a port that exists, so they are upper bounds on the direct port; a design that drops
  `StupidSandbox`, for example, removes 318 of them.
- `Sandbox.py`'s 1,539 lines are not 1,539 lines of gap: the launch, flag rendering, log
  reading and exit classification halves are in `sandbox/` (`~700` lines), and the file API is
  in `stage/` (`~200`). The row's gap is the remainder.
- The claim that no score is computed in Rust was checked in the worker, `cms-db`, `ranking-web`
  and `admin-panel`. If a scoring path exists outside those four, it was not found by
  `grep -rn 'compute_score\|max_scores\|task_score'` over `*.rs`, `*.ts`, `*.tsx`, `*.sql`.
