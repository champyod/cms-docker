-- ============================================================================
-- fix_task_type_parameters.sql
--
-- Purpose : repair datasets whose task_type_parameters is an EMPTY array,
--           which makes evaluation impossible: the worker raises ValueError
--           before any testcase runs (src/cms/grading/tasktypes/abc.py:114-123,
--           reached via src/cms/service/Worker.py:127-128).
--
-- Report  : defect report item [10] claims "Contest 3 / task aplusb:
--           datasets 12 and 15 have task_type_parameters = []".
--           IMPORTANT: that the rows exist, that they are ids 12/15, and the
--           "34 tables" figure are UNVERIFIED LIVE-DATA claims. Section 1 is
--           what confirms or refutes them. Do not assume the ids.
--
-- !! THIS FILE TOUCHES A LIVE DATABASE. Section 3 MUTATES DATA. !!
-- Review it, run Section 1 (read-only) first, and only then decide whether
-- Section 3 applies. Sections 1, 2 and 4 are strictly read-only.
-- Target: PostgreSQL (metadata database). Column types: the ORM declares
--   task_type_parameters as JSONB (src/cms/db/task.py:438) and the Prisma
--   schema declares Json (admin-panel/prisma/schema.prisma:108). Both are
--   satisfied by the JSON array literals used below.
--
-- CRITICAL CONTEXT (verified in the repo at HEAD fix/defect-sweep-oct08):
--   "aplusb" is NOT a registered CMS task type. The registry is built from
--   setuptools entry points (src/setup.py:165-171) and contains exactly:
--     Batch, BatchAndOutput, Communication, OutputOnly, TwoSteps
--   (src/cms/grading/tasktypes/__init__.py:48-49 -> src/cms/plugin.py:30-54;
--    get_task_type_class does a bare dict lookup -> KeyError for unknown names,
--    __init__.py:52-54.) "aplusb" appears in the repo only as a task NAME
--    example (admin-panel/src/components/tasks/task-modal-sections.tsx:29,35;
--    admin-panel/tests/evaluation-submission-record-routes.test.ts:233).
--   Therefore, in the live DB, task_type is expected to hold a registered
--   type name such as 'Batch' -- the report is almost certainly reading the
--   TASK name "aplusb", not the datasets' task_type value. Section 1 verifies
--   this distinction before anything is written.
--
--   Consequences, by case:
--     Case A - task_type is a registered type (expected): writing that type's
--              default parameter list fixes the defect (Section 3, block A).
--     Case B - task_type literally holds a name the grader does not implement
--              (e.g. 'aplusb'): parameters alone cannot fix it. The row needs
--              a real task type chosen first (Section 3, block B is commented
--              out because that is a semantic choice no script may make).
-- ============================================================================


-- ============================================================================
-- SECTION 1 — DIAGNOSTIC (READ-ONLY, safe on production, run this first)
-- ============================================================================

-- 1.1 Every dataset with an empty / non-array task_type_parameters, with its
--     task, contest and stored type. This is the definitive list of rows the
--     repair would touch; it is also what confirms or refutes "12 and 15".
SELECT
    d.id                                AS dataset_id,
    d.task_id,
    c.id                                AS contest_id,
    c.name                              AS contest_name,
    t.name                              AS task_name,
    t.title                             AS task_title,
    d.task_type,
    d.description                       AS dataset_description,
    jsonb_typeof(d.task_type_parameters) AS params_json_type,
    CASE
        WHEN jsonb_typeof(d.task_type_parameters) = 'array'
            THEN jsonb_array_length(d.task_type_parameters)
        ELSE NULL
    END                                 AS params_length,
    (t.active_dataset_id = d.id)        AS is_active_dataset,
    (SELECT count(*) FROM managers m WHERE m.dataset_id = d.id)    AS manager_count,
    (SELECT count(*) FROM testcases tc WHERE tc.dataset_id = d.id) AS testcase_count
FROM datasets d
JOIN tasks    t ON t.id = d.task_id
LEFT JOIN contests c ON c.id = t.contest_id
WHERE d.task_type_parameters IS NULL
   OR jsonb_typeof(d.task_type_parameters) <> 'array'
   OR jsonb_array_length(d.task_type_parameters) = 0
ORDER BY c.id, t.id, d.id;

-- 1.2 Count of affected rows. Expected single value: 2 if the report is right.
SELECT count(*) AS affected_datasets
FROM datasets d
WHERE d.task_type_parameters IS NULL
   OR jsonb_typeof(d.task_type_parameters) <> 'array'
   OR jsonb_array_length(d.task_type_parameters) = 0;

-- 1.3 Affected rows grouped by stored task_type. THE DECIDING QUERY for the
--     question "is aplusb a task_type value, or only a task name?":
--       * rows grouped under 'Batch' (or another registered type) -> Case A,
--         run Section 3 block A;
--       * any group whose key is NOT one of
--         Batch / BatchAndOutput / Communication / OutputOnly / TwoSteps
--         -> Case B for those rows; do NOT run block A on them.
SELECT
    d.task_type,
    count(*)                       AS affected_datasets,
    array_agg(d.id ORDER BY d.id)  AS dataset_ids
FROM datasets d
WHERE d.task_type_parameters IS NULL
   OR jsonb_typeof(d.task_type_parameters) <> 'array'
   OR jsonb_array_length(d.task_type_parameters) = 0
GROUP BY d.task_type
ORDER BY affected_datasets DESC, d.task_type;

-- 1.4 Reference: the parameter arity each REGISTERED type requires. Use this
--     to sanity-check what Section 3 will write (arities from the classes):
--       Batch          -> 3   src/cms/grading/tasktypes/Batch.py:116
--       BatchAndOutput -> 4   src/cms/grading/tasktypes/BatchAndOutput.py:87
--       Communication  -> 3   src/cms/grading/tasktypes/Communication.py:121
--       OutputOnly     -> 1   src/cms/grading/tasktypes/OutputOnly.py:71
--       TwoSteps       -> 1   src/cms/grading/tasktypes/TwoSteps.py:88
SELECT
    d.task_type,
    d.id                       AS dataset_id,
    jsonb_array_length(d.task_type_parameters) AS stored_length,
    CASE d.task_type
        WHEN 'Batch' THEN 3 WHEN 'BatchAndOutput' THEN 4
        WHEN 'Communication' THEN 3 WHEN 'OutputOnly' THEN 1
        WHEN 'TwoSteps' THEN 1 ELSE NULL
    END                        AS required_length,
    (CASE d.task_type
        WHEN 'Batch' THEN 3 WHEN 'BatchAndOutput' THEN 4
        WHEN 'Communication' THEN 3 WHEN 'OutputOnly' THEN 1
        WHEN 'TwoSteps' THEN 1 ELSE NULL
    END) = jsonb_array_length(d.task_type_parameters) AS would_pass_arity_check
FROM datasets d
ORDER BY (d.task_type_parameters = '[]'::jsonb) DESC NULLS LAST, d.id;

-- 1.5 Optional context: which tasks/contests the suspicious task name lives
--     under, to corroborate "Contest 3". Read-only.
SELECT t.id AS task_id, t.name, t.title, c.id AS contest_id, c.name AS contest_name
FROM tasks t
LEFT JOIN contests c ON c.id = t.contest_id
WHERE t.name = 'aplusb'
ORDER BY t.id;


-- ============================================================================
-- SECTION 2 — PRE-UPDATE EYEBALL (READ-ONLY)
-- Run immediately before Section 3 in the SAME session. It shows exactly the
-- rows the UPDATE in block A will hit, and the value it will write.
-- Expected: the same rows as 1.1, each with params_length = 0, and a
-- non-null proposed_parameters. If anything else appears, STOP.
-- ============================================================================
SELECT
    d.id AS dataset_id,
    d.task_type,
    CASE d.task_type
        WHEN 'Batch'          THEN '["alone", ["", ""], "diff"]'::jsonb
        WHEN 'BatchAndOutput' THEN '["alone", ["", ""], "diff", ""]'::jsonb
        WHEN 'Communication'  THEN '[1, "alone", "std_io"]'::jsonb
        WHEN 'OutputOnly'     THEN '["diff"]'::jsonb
        WHEN 'TwoSteps'       THEN '["diff"]'::jsonb
        ELSE NULL
    END AS proposed_parameters
FROM datasets d
WHERE (d.task_type_parameters IS NULL
       OR jsonb_typeof(d.task_type_parameters) <> 'array'
       OR jsonb_array_length(d.task_type_parameters) = 0)
  AND d.task_type IN ('Batch', 'BatchAndOutput', 'Communication',
                      'OutputOnly', 'TwoSteps')
ORDER BY d.id;


-- ============================================================================
-- SECTION 3 — REPAIR (MUTATING — NEEDS OPERATOR CONFIRMATION)
-- Only run after Section 1.3 has classified every affected row and Section 2
-- matches expectations. Wrap in one transaction; COMMIT only after Section 4
-- (inside the same transaction) shows the expected result.
-- ============================================================================

BEGIN;

-- Block A — rows whose task_type is a REGISTERED type get that type's
-- documented defaults. These literals come from the classes themselves:
--   Batch:         compilation 'alone' (Batch.py:87), I/O pair ['',''] meaning
--                  stdin/stdout (Batch.py:100-115, docstring Batch.py:51-60),
--                  output eval 'diff' (Batch.py:85). -> Batch.py:116 arity 3.
--   BatchAndOutput: Batch's 3 + output-only testcase list '' (BatchAndOutput.py:82-87).
--   Communication: num_processes 1 (Communication.py:101), 'alone' (:94),
--                  'std_io' (:96). -> Communication.py:121 arity 3.
--   OutputOnly / TwoSteps: single 'diff' choice (OutputOnly.py:58-71,
--                  TwoSteps.py:76-88).
-- The condition is the DEFECT (empty parameter list), not ids 12/15, so a
-- different live database with the same defect is repaired too. Rows already
-- populated are untouched: this is not an overwrite of working data.
UPDATE datasets
SET task_type_parameters = CASE task_type
        WHEN 'Batch'          THEN '["alone", ["", ""], "diff"]'::jsonb
        WHEN 'BatchAndOutput' THEN '["alone", ["", ""], "diff", ""]'::jsonb
        WHEN 'Communication'  THEN '[1, "alone", "std_io"]'::jsonb
        WHEN 'OutputOnly'     THEN '["diff"]'::jsonb
        WHEN 'TwoSteps'       THEN '["diff"]'::jsonb
    END
WHERE (task_type_parameters IS NULL
       OR jsonb_typeof(task_type_parameters) <> 'array'
       OR jsonb_array_length(task_type_parameters) = 0)
  AND task_type IN ('Batch', 'BatchAndOutput', 'Communication',
                    'OutputOnly', 'TwoSteps');
-- Expect: UPDATE 0..N (N = count from Section 1.2, if all rows are Case A).
-- If N is larger than the number of rows Section 2 showed, that means rows
-- with a task_type you have not reviewed are affected: ROLLBACK and extend
-- Section 1 before proceeding.

-- Block B — rows whose task_type is NOT a registered type (the report's
-- literal reading, e.g. task_type = 'aplusb'). DELIBERATELY NOT ENABLED.
-- Reason: no parameter list can make an unknown type name constructible --
-- get_task_type_class does a bare dict lookup and raises KeyError
-- (src/cms/grading/tasktypes/__init__.py:52-54). Fixing those rows means
-- choosing which real type the task should use, which is a semantics
-- decision owned by the contest admins, not by a repair script. Once the
-- choice is confirmed (for a whole-input/whole-output A+B style task with a
-- checker or white diff, 'Batch' is the usual analogue), uncomment and edit:
--
--   UPDATE datasets
--   SET task_type = 'Batch',                              -- editor: chosen type
--       task_type_parameters = '["alone", ["", ""], "diff"]'::jsonb
--   WHERE task_type NOT IN ('Batch', 'BatchAndOutput', 'Communication',
--                           'OutputOnly', 'TwoSteps')
--     AND (task_type_parameters IS NULL
--          OR jsonb_typeof(task_type_parameters) <> 'array'
--          OR jsonb_array_length(task_type_parameters) = 0);
--
-- If any such row has managers named 'checker' or a grader, revisit the
-- literal above: the last element must then likely be 'comparator', not
-- 'diff' (Batch.py:85-86), and check with:
--   SELECT d.id, m.filename FROM datasets d
--   JOIN managers m ON m.dataset_id = d.id
--   WHERE d.task_type NOT IN ('Batch','BatchAndOutput','Communication',
--                             'OutputOnly','TwoSteps')
--     AND (d.task_type_parameters IS NULL
--          OR jsonb_typeof(d.task_type_parameters) <> 'array'
--          OR jsonb_array_length(d.task_type_parameters) = 0);

-- SECTION 4 — VERIFICATION (run BEFORE COMMIT; read-only)
-- Expect: the second result set returns ZERO rows, and every row in the
-- first result set shows would_pass_arity_check = true. That is exactly the
-- property the grader checks: len(parameters) == len(ACCEPTED_PARAMETERS)
-- (src/cms/grading/tasktypes/abc.py:118-123), plus element validation
-- (:125-126). A row still failing would_pass_arity_check means its
-- task_type was not one of the five registered names -> Case B.
SELECT
    d.id AS dataset_id,
    d.task_type,
    jsonb_array_length(d.task_type_parameters) AS params_length,
    (CASE d.task_type
        WHEN 'Batch' THEN 3 WHEN 'BatchAndOutput' THEN 4
        WHEN 'Communication' THEN 3 WHEN 'OutputOnly' THEN 1
        WHEN 'TwoSteps' THEN 1 ELSE NULL
    END) = jsonb_array_length(d.task_type_parameters) AS would_pass_arity_check
FROM datasets d
WHERE d.task_type IN ('Batch', 'BatchAndOutput', 'Communication',
                      'OutputOnly', 'TwoSteps')
ORDER BY d.id;

-- Still-empty rows (expected: none). Any row here is Case B or untouched.
SELECT d.id, d.task_type, d.task_type_parameters
FROM datasets d
WHERE d.task_type_parameters IS NULL
   OR jsonb_typeof(d.task_type_parameters) <> 'array'
   OR jsonb_array_length(d.task_type_parameters) = 0;

COMMIT;

-- ROLLBACK NOTE
-- On a bad result, run `ROLLBACK;` INSTEAD of `COMMIT;`. After a commit, the
-- rows this script touched previously held '[]' (or were NULL); the reverse
-- statement is, using the ids recorded from Section 1.1:
--   BEGIN;
--   UPDATE datasets SET task_type_parameters = '[]'::jsonb
--   WHERE id IN (/* ids from Section 1.1 */);
--   -- block B rows additionally need their previous task_type restored.
--   COMMIT;
-- For anything beyond that, restore from the pre-change backup / pg_dump.
-- The UPDATE is conditional on "empty", so it cannot silently overwrite a
-- parameter list that was already valid.


-- ============================================================================
-- SECTION 5 — OPERATIONAL NOTES
-- ============================================================================
-- * What this file CANNOT verify without the live database: whether datasets
--   12/15 exist, their stored task_type, and the report's "34 tables" figure.
--   Section 1.1/1.2/1.3 resolve all of it; 1.3 additionally answers whether
--   'aplusb' is stored as a task_type (Case B) or only appears as a task name
--   (Case A, and then the datasets should carry 'Batch' or similar).
-- * After commit, a previously failing evaluation may sit in a bad state;
--   invalidate/rejudge the affected submission results per the usual CMS
--   workflow (EvaluationService rewrites results when a dataset is
--   invalidated). Verify with a fresh submission against the affected
--   dataset rather than trusting historical rows.
-- * Recurrence prevention lives in the admin panel, not here: creation
--   defaults to an empty array (admin-panel/src/app/actions/datasets.ts:37)
--   and per-update self-healing only triggers when params were sent or the
--   stored value was already empty (same file :224). Consider hardening
--   separately; this script only repairs existing rows.
-- ============================================================================
