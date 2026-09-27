//! The four judging statements, checked against the columns of the shape each
//! one writes rather than against a database.
//!
//! Every check reads the statement itself: the column list it names, the
//! placeholders it binds and their order, the key it upserts on, the arrays a
//! row set binds, and the cast each column that is not text needs. No connection
//! is opened.

use cms_db::{
    CompilationOutcome, EvaluationOutcome, INSERT_EVALUATIONS, INSERT_EXECUTABLES, UPSERT_RESULT,
    UPSERT_SCORE,
};

/// Every statement, with the columns of the shape it writes, in binding order.
const STATEMENTS: [(&str, &str); 4] = [
    (
        UPSERT_RESULT,
        "submission_id dataset_id compilation_outcome compilation_text compilation_tries \
        compilation_stdout compilation_stderr compilation_time compilation_wall_clock_time \
        compilation_memory compilation_shard compilation_sandbox_paths compilation_sandbox_digests \
        evaluation_outcome evaluation_tries",
    ),
    (
        UPSERT_SCORE,
        "submission_id dataset_id score score_details scored_at public_score \
        public_score_details ranking_score_details",
    ),
    (
        INSERT_EXECUTABLES,
        "submission_id dataset_id filename digest",
    ),
    (
        INSERT_EVALUATIONS,
        "submission_id dataset_id testcase_id outcome text admin_text \
        execution_time execution_wall_clock_time execution_memory evaluation_shard \
        evaluation_sandbox_paths evaluation_sandbox_digests",
    ),
];

/// The column list a statement names, in the order it names them.
fn inserted_columns(sql: &str) -> Vec<&str> {
    let open = sql.find(" (").expect("a write names its columns");
    let rest = &sql[open + 2..];
    let close = rest.find(')').expect("the column list closes");
    rest[..close].split(',').map(str::trim).collect()
}

/// The placeholder numbers a statement binds, in the order it writes them.
fn bound_placeholders(sql: &str) -> Vec<String> {
    sql.split('$')
        .skip(1)
        .filter_map(|after| {
            let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
            (!digits.is_empty()).then_some(digits)
        })
        .collect()
}

#[test]
fn every_statement_names_exactly_the_columns_its_shape_declares() {
    for (sql, columns) in STATEMENTS {
        let declared: Vec<&str> = columns.split_ascii_whitespace().collect();
        let named = inserted_columns(sql);

        assert!(
            !named.contains(&"*"),
            "{sql} names a column it does not declare"
        );
        assert_eq!(named, declared, "{sql} drifted from its shape");
    }
}

#[test]
fn every_statement_binds_one_placeholder_per_column_in_order() {
    for (sql, _) in STATEMENTS {
        let bound = bound_placeholders(sql);
        let ordered: Vec<String> = (1..=bound.len()).map(|at| at.to_string()).collect();

        assert_eq!(bound, ordered, "{sql} binds out of order");
        assert_eq!(
            bound.len(),
            inserted_columns(sql).len(),
            "{sql} binds twice or not at all"
        );
    }
}

#[test]
fn a_result_row_is_upserted_on_the_key_the_read_looks_up() {
    for sql in [UPSERT_RESULT, UPSERT_SCORE] {
        let upsert = "ON CONFLICT (submission_id, dataset_id) DO UPDATE SET";

        assert!(
            sql.contains(upsert),
            "{sql} does not upsert on the composite key"
        );
    }
}

#[test]
fn a_row_set_is_written_by_one_statement_binding_one_array_per_column() {
    for sql in [INSERT_EXECUTABLES, INSERT_EVALUATIONS] {
        let columns = inserted_columns(sql).len();

        assert!(
            sql.contains("SELECT * FROM unnest("),
            "{sql} does not batch its rows"
        );
        assert_eq!(
            sql.matches("::").count(),
            columns,
            "{sql} binds the wrong arrays"
        );
    }
}

#[test]
fn a_column_that_is_not_text_is_cast_to_its_own_type() {
    let casts = [
        (UPSERT_RESULT, "$3::compilation_outcome"),
        (UPSERT_RESULT, "$14::evaluation_outcome"),
        (UPSERT_SCORE, "$4::jsonb"),
        (UPSERT_SCORE, "$7::jsonb"),
    ];

    for (sql, cast) in casts {
        assert!(sql.contains(cast), "{sql} binds {cast} nowhere");
    }
}

#[test]
fn an_outcome_spells_the_only_value_its_column_accepts() {
    assert_eq!(CompilationOutcome::Ok.as_str(), "ok");
    assert_eq!(CompilationOutcome::Fail.as_str(), "fail");
    assert_eq!(EvaluationOutcome::Ok.as_str(), "ok");
}
