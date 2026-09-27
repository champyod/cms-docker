//! The four statements a judging commit is executed for.
//!
//! Each one is column-exact and takes one placeholder per column, in the order
//! its shape declares the fields, so the caller binds a row in the order the
//! struct holds it. The two `submission_results` statements upsert on the
//! composite key; the two row sets bind one array per column and let `unnest`
//! pair them, which is what writes a whole object in one round trip instead of
//! one statement per testcase.
//!
//! Nothing here opens a connection: these are the statements the batch layer
//! executes, and the `unnest` array types are what the row sets bind against.

/// The `submission_results` columns one object result writes, upserted on the
/// composite key `get_result_or_create` looks the row up by.
pub const UPSERT_RESULT: &str = "\
    INSERT INTO submission_results (submission_id, dataset_id, compilation_outcome, \
        compilation_text, compilation_tries, compilation_stdout, compilation_stderr, \
        compilation_time, compilation_wall_clock_time, compilation_memory, \
        compilation_shard, compilation_sandbox_paths, compilation_sandbox_digests, \
        evaluation_outcome, evaluation_tries) \
    VALUES ($1, $2, $3::compilation_outcome, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::evaluation_outcome, $15) \
    ON CONFLICT (submission_id, dataset_id) DO UPDATE SET \
        compilation_outcome = EXCLUDED.compilation_outcome, compilation_text = EXCLUDED.compilation_text, \
        compilation_tries = EXCLUDED.compilation_tries, compilation_stdout = EXCLUDED.compilation_stdout, \
        compilation_stderr = EXCLUDED.compilation_stderr, compilation_time = EXCLUDED.compilation_time, \
        compilation_wall_clock_time = EXCLUDED.compilation_wall_clock_time, compilation_memory = EXCLUDED.compilation_memory, \
        compilation_shard = EXCLUDED.compilation_shard, compilation_sandbox_paths = EXCLUDED.compilation_sandbox_paths, \
        compilation_sandbox_digests = EXCLUDED.compilation_sandbox_digests, evaluation_outcome = EXCLUDED.evaluation_outcome, \
        evaluation_tries = EXCLUDED.evaluation_tries";

/// The `executables` columns one compilation's set writes, one array bound per
/// column so the whole set lands in one statement.
pub const INSERT_EXECUTABLES: &str = "\
    INSERT INTO executables (submission_id, dataset_id, filename, digest) \
    SELECT * FROM unnest($1::integer[], $2::integer[], $3::varchar[], $4::varchar[])";

/// The `evaluations` columns one testcase run writes, one array bound per column
/// so every testcase of one object lands in one statement.
pub const INSERT_EVALUATIONS: &str = "\
    INSERT INTO evaluations (submission_id, dataset_id, testcase_id, outcome, text, admin_text, \
        execution_time, execution_wall_clock_time, execution_memory, evaluation_shard, \
        evaluation_sandbox_paths, evaluation_sandbox_digests) \
    SELECT * FROM unnest($1::integer[], $2::integer[], $3::integer[], $4::varchar[], $5::varchar[], \
        $6::varchar[], $7::double precision[], $8::double precision[], $9::bigint[], $10::integer[], \
        $11::varchar[], $12::varchar[])";

/// The `submission_results` score columns one scoring pass writes, upserted on
/// the same key, leaving a score already stored alone until it is recomputed.
pub const UPSERT_SCORE: &str = "\
    INSERT INTO submission_results (submission_id, dataset_id, score, score_details, \
        scored_at, public_score, public_score_details, ranking_score_details) \
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8) \
    ON CONFLICT (submission_id, dataset_id) DO UPDATE SET \
        score = EXCLUDED.score, score_details = EXCLUDED.score_details, \
        scored_at = EXCLUDED.scored_at, public_score = EXCLUDED.public_score, \
        public_score_details = EXCLUDED.public_score_details, \
        ranking_score_details = EXCLUDED.ranking_score_details";
