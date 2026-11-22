//! The pg_dump that wrote the fixture: the deployment's own image, never a host binary.
//!
//! WHY docker: production dumps on the pinned image, and no script here keeps a host pg_dump.
//! The 16.16 that made this gate pass lived in a scratch directory that pruned a day later.
//! Docker is now a prerequisite of this test, as it already is of the test database.

use std::io::ErrorKind;
use std::process::{Command, Output};

/// The compose file that pins the deployment's database, so the dumper cannot drift from it.
const COMPOSE: &str = include_str!("../../../../docker-compose.yml");

/// The postgres image docker-compose.yml pins, digest included.
fn image() -> &'static str {
    COMPOSE
        .lines()
        .filter_map(|line| line.trim().strip_prefix("image:"))
        .map(str::trim)
        .find(|image| image.starts_with("postgres:"))
        .expect("docker-compose.yml pins the postgres image this dump comes from")
}

/// `pg_dump` out of the pinned image, in a container sharing the host's network namespace.
///
/// WHY host networking: the test URL names 127.0.0.1, which only the host answers.
fn pg_dump(arguments: &[&str]) -> Output {
    let image = image();
    Command::new("docker")
        .args([
            "run",
            "--rm",
            "--network",
            "host",
            "--entrypoint",
            "pg_dump",
        ])
        .arg(image)
        .args(arguments)
        .output()
        .unwrap_or_else(|error| match error.kind() {
            ErrorKind::NotFound => {
                panic!("the dumper runs in docker, and docker is not on PATH; start docker")
            }
            _ => panic!("docker could not run pg_dump from {image}: {error}"),
        })
}

/// A run's stdout, or a panic naming the image and docker's own words.
fn stdout_of(output: Output, what: &str) -> String {
    assert!(
        output.status.success(),
        "pg_dump {what} failed in {}: {}",
        image(),
        String::from_utf8_lossy(&output.stderr).trim()
    );
    String::from_utf8(output.stdout).expect("pg_dump writes UTF-8")
}

/// `pg_dump --schema-only` over the database the URL names.
///
/// WHY the dump and not a catalogue query: the fixture is this command's output.
#[must_use]
pub fn dump(url: &str) -> String {
    stdout_of(
        pg_dump(&["--schema-only", "--dbname", url]),
        "over the check database",
    )
}
