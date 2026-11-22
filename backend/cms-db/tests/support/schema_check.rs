//! The frozen dump, the command that produced it, and the comparison.
//!
//! `dev/fixtures/cms_schema.sql` is `pg_dump --schema-only` over a database that
//! `cms.db.init_db` had just filled, so it is the reference's schema rather than a
//! transcription of it.

use std::process::Command;

use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

/// The reference's own dump, frozen.
pub const FIXTURE: &str = include_str!("../../../../dev/fixtures/cms_schema.sql");

/// The tables `cms.db.init_db` creates: its 40 models minus the 13 Prisma owns.
pub const TABLES: i64 = 27;

/// The domains the five `compile_*` functions emit.
pub const DOMAINS: i64 = 5;

/// The database this check creates, which it drops again before it asserts.
pub const CHECK_DATABASE: &str = "cms_schema_check";

/// The scratch database's URL, or a printed skip when none is configured.
pub fn skip() -> Option<String> {
    let url = std::env::var("CMS_DB_TEST_URL")
        .ok()
        .filter(|url| !url.trim().is_empty());
    if url.is_none() {
        eprintln!("SKIP: set CMS_DB_TEST_URL to a scratch database to run the live half");
    }
    url
}

/// The database a URL names, which must carry `test` before a check may create one.
#[must_use]
pub fn database_name(url: &str) -> &str {
    let path = url.split_once('?').map_or(url, |(path, _query)| path);
    path.rsplit_once('/').map_or(path, |(_prefix, name)| name)
}

/// The same URL pointing at another database.
#[must_use]
pub fn with_database(url: &str, name: &str) -> String {
    let (path, query) = match url.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (url, None),
    };
    let (prefix, _current) = path
        .rsplit_once('/')
        .expect("a database URL has a path component");
    match query {
        Some(query) => format!("{prefix}/{name}?{query}"),
        None => format!("{prefix}/{name}"),
    }
}

/// Create `name`, replacing one a previous run left behind.
pub async fn create_database(connection: &mut PgConnection, name: &str) {
    let drop = format!("DROP DATABASE IF EXISTS {name} WITH (FORCE)");
    sqlx::raw_sql(AssertSqlSafe(drop))
        .execute(&mut *connection)
        .await
        .expect("dropping the check database a previous run left behind");
    let create = format!("CREATE DATABASE {name}");
    sqlx::raw_sql(AssertSqlSafe(create))
        .execute(&mut *connection)
        .await
        .expect("creating the check database");
}

/// Drop `name`, so a failing comparison is the only thing left to look at.
pub async fn drop_database(connection: &mut PgConnection, name: &str) {
    let drop = format!("DROP DATABASE IF EXISTS {name} WITH (FORCE)");
    sqlx::raw_sql(AssertSqlSafe(drop))
        .execute(&mut *connection)
        .await
        .expect("dropping the check database");
}

/// A count of the catalogue rows `sql` names, for the shape assertions.
pub async fn count(connection: &mut PgConnection, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(&mut *connection)
        .await
        .expect("counting catalogue rows")
}

/// `pg_dump --schema-only` over the database the URL names.
///
/// WHY the binary and not a catalogue query: the fixture is that command's output,
/// so only the same command can be compared with it.
#[must_use]
pub fn dump(url: &str) -> String {
    let output = Command::new("pg_dump")
        .args(["--schema-only", "--dbname", url])
        .output()
        .expect("pg_dump must be on PATH to compare against the frozen dump");
    assert!(
        output.status.success(),
        "pg_dump refused the check database: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("pg_dump writes UTF-8")
}

/// The `X.Y` pg_dump reports in a dump's header, without any build suffix.
///
/// WHY: the fixture was dumped by one build of 16.16 and a runner may have another
/// whose statements still match; 16.15 does not, and its diff reads as a schema
/// difference rather than the tool difference it is.
#[must_use]
pub fn dump_version(dump: &str) -> Option<String> {
    dump.lines()
        .find_map(|line| line.strip_prefix("-- Dumped by pg_dump version "))
        .and_then(|version| version.split_whitespace().next())
        .map(str::to_owned)
}

/// The statements of a dump, without the comments, session settings and ownership
/// lines both sides carry: those name a role and a dump version, not the schema.
#[must_use]
pub fn statements(dump: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in dump.lines() {
        if line.is_empty()
            || line.starts_with("--")
            || line.starts_with('\\')
            || line.starts_with("SET ")
            || line.starts_with("SELECT pg_catalog.set_config")
            || (line.starts_with("ALTER ") && line.contains(" OWNER TO "))
        {
            continue;
        }
        current.push(line);
        if line.ends_with(';') {
            statements.push(current.join("\n"));
            current.clear();
        }
    }
    assert!(current.is_empty(), "a dump ends with a complete statement");
    statements
}

/// The first statement the two schemas disagree on, or an empty string.
#[must_use]
pub fn difference(expected: &[String], actual: &[String]) -> String {
    if expected == actual {
        return String::new();
    }
    let first = expected
        .iter()
        .zip(actual)
        .position(|(expected, actual)| expected != actual)
        .unwrap_or_else(|| expected.len().min(actual.len()));
    format!(
        "{} statements expected, {} created; first difference at statement {}:\n\
         expected:\n{}\n\ncreated:\n{}",
        expected.len(),
        actual.len(),
        first + 1,
        expected.get(first).map_or("<missing>", String::as_str),
        actual.get(first).map_or("<missing>", String::as_str),
    )
}
