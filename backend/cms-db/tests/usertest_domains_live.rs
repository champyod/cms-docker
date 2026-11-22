//! The user-test name and digest domains against a real server.
//!
//! WHY live: the domains are `CHECK` expressions on the columns, so the server
//! refusing the same value is the proof that this port refuses it too. Each
//! table is `TEMP`, so a run leaves the scratch database as it found it.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test usertest_domains_live

use cms_db::{FileDigest, Filename, FilenameSchema, UserTestFile, UserTestFiles};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/usertest_db.rs"]
mod usertest_db;

use usertest_db::{code_of, digest, insert_file, insert_manager, open, skip, USER_TEST};

#[tokio::test]
async fn the_filename_domain_refuses_the_same_names_as_the_database() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    for name in ["a/b", ".", ".."] {
        assert!(
            FilenameSchema::parse(name).is_err(),
            "{name} passed the schema domain"
        );
        assert!(
            Filename::parse(name).is_err(),
            "{name} passed the filename domain"
        );
        let refused_file = insert_file(connection.connection(), name).await;
        assert_eq!(
            code_of(&refused_file).as_deref(),
            Some("23514"),
            "the database accepted file {name}"
        );
        let refused_manager = insert_manager(connection.connection(), name).await;
        assert_eq!(
            code_of(&refused_manager).as_deref(),
            Some("23514"),
            "the database accepted manager {name}"
        );
    }
}

#[tokio::test]
async fn the_digest_domain_refuses_the_same_values_as_the_database() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    for value in ["", "zz", "0123456789ABCDEF0123456789abcdef01234567"] {
        assert!(
            value.parse::<FileDigest>().is_err(),
            "{value:?} passed the digest domain"
        );
        let inserted = sqlx::query(
            "INSERT INTO user_test_files (user_test_id, filename, digest) \
             VALUES ($1, 'input.%l', $2)",
        )
        .bind(USER_TEST)
        .bind(value)
        .execute(connection.connection())
        .await;
        assert_eq!(
            code_of(&inserted).as_deref(),
            Some("23514"),
            "the database accepted digest {value:?}"
        );
    }
}

#[tokio::test]
async fn the_files_set_and_the_database_refuse_the_same_duplicate() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let filename = FilenameSchema::parse("input.%l").expect("fixture name");
    let mut files = UserTestFiles::new(USER_TEST);
    files
        .insert(UserTestFile {
            id: 1,
            user_test_id: USER_TEST,
            filename: filename.clone(),
            digest: digest(),
        })
        .expect("first file");

    assert!(files
        .insert(UserTestFile {
            id: 2,
            user_test_id: USER_TEST,
            filename,
            digest: digest(),
        })
        .is_err());
    insert_file(connection.connection(), "input.%l")
        .await
        .expect("first file");
    let refused = insert_file(connection.connection(), "input.%l").await;
    assert_eq!(code_of(&refused).as_deref(), Some("23505"));
}
