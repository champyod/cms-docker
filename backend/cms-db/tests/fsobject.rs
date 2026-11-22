//! One `fsobjects` row: the claim it makes, and the bytes it points at.
//!
//! WHY live: the row and the large object are two transactions on two connections,
//! and only a server can show that a second connection reads what the first wrote.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test fsobject

use std::io::SeekFrom;

use cms_db::{
    bytes_digest, FSObject, FileDigest, LargeObject, Mode, SessionConfig, FSOBJECT_DECLARATION,
    NO_LARGE_OBJECT,
};
use sqlx::postgres::PgConnection;
use sqlx::Connection;

mod support;

const URL_ENV: &str = "CMS_DB_TEST_URL";

/// The content the row's large object holds, and the digest it is filed under.
const CONTENT: &[u8] = b"a stored file";

fn skip() -> Option<SessionConfig> {
    let config = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(SessionConfig::new);
    if config.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    config
}

async fn connect(config: &SessionConfig) -> PgConnection {
    PgConnection::connect_with(&config.connect_options().expect("reading the test URL"))
        .await
        .expect("connecting to the test database")
}

fn digest() -> FileDigest {
    bytes_digest(CONTENT)
        .parse()
        .expect("the content's digest is a digest")
}

#[test]
fn the_declaration_describes_the_table_and_its_key() {
    FSOBJECT_DECLARATION
        .validate()
        .expect("the declaration must describe a table");

    assert_eq!(FSOBJECT_DECLARATION.table, "fsobjects");
    let names: Vec<&str> = FSOBJECT_DECLARATION
        .columns
        .iter()
        .map(|column| column.name)
        .collect();
    assert_eq!(names, ["digest", "loid", "description"]);
    assert!(FSOBJECT_DECLARATION.columns[0].primary_key);
    assert_eq!(FSOBJECT_DECLARATION.columns[1].kind.rust_type(), "u32");
    assert!(FSOBJECT_DECLARATION.columns[2].nullable);

    // A key is identity, not a value the attribute set carries, as in the reference.
    let carried: Vec<&str> = FSOBJECT_DECLARATION
        .value_columns()
        .map(|column| column.name)
        .collect();
    assert_eq!(carried, ["loid", "description"]);
}

#[test]
fn a_row_without_a_large_object_refuses_to_open_one() {
    let row = FSObject {
        digest: digest(),
        loid: NO_LARGE_OBJECT,
        description: None,
    };
    let config = SessionConfig::new("postgres://unused/unused");
    let error = sqlx::test_block_on(row.open_large_object(&config, Mode::READ));
    assert!(matches!(
        error,
        Err(cms_db::FsObjectError::NoLargeObject(_))
    ));
}

#[test]
fn a_row_links_its_digest_to_bytes_a_second_connection_reads() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&config).await;
        support::create(&mut connection).await;
        let row = FSObject {
            digest: digest(),
            loid: NO_LARGE_OBJECT,
            description: Some("a probe".to_owned()),
        };
        sqlx::query("DELETE FROM fsobjects WHERE digest = $1::varchar")
            .bind(row.digest.as_str())
            .execute(&mut connection)
            .await
            .expect("clearing a previous run");

        let mut writer = LargeObject::create(&config, Mode::WRITE)
            .await
            .expect("creating the large object");
        writer.write(CONTENT).await.expect("writing the bytes");
        let loid = writer.loid();
        writer.close().await.expect("committing the bytes");
        let row = FSObject { loid, ..row };
        row.insert(&mut connection)
            .await
            .expect("inserting the row");

        let mut other = connect(&config).await;
        let found = FSObject::get(&mut other, &row.digest)
            .await
            .expect("selecting the row")
            .expect("the row the first connection wrote");
        assert_eq!(found, row);
        assert!(FSObject::get_all(&mut other)
            .await
            .expect("listing the rows")
            .contains(&row));

        let mut reader = found
            .open_large_object(&config, Mode::READ)
            .await
            .expect("opening the large object");
        let mut buffer = [0_u8; 32];
        let read = reader.read(&mut buffer).await.expect("reading the bytes");
        assert_eq!(&buffer[..read], CONTENT);
        assert_eq!(
            reader.seek(SeekFrom::End(0)).await.expect("measuring"),
            CONTENT.len() as u64
        );
        reader.close().await.expect("closing the reader");

        found.delete(&config, &mut other).await.expect("deleting");
        assert!(FSObject::get(&mut other, &row.digest)
            .await
            .expect("selecting after the delete")
            .is_none());
        assert!(
            LargeObject::open(&config, row.loid, Mode::READ)
                .await
                .is_err(),
            "the row's delete left its large object behind"
        );
    });
}
