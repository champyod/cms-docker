//! The task and submission rules against a real server: a token play is a row, a status is columns, and the dataset rules are foreign keys.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test judging

#[path = "../support/judging/rows.rs"]
mod rows;
#[path = "../support/judging/schema.rs"]
mod schema;

mod fixtures;
mod results;
mod task;
mod tokens;
