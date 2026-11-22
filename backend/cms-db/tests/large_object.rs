//! A large object round-trips bytes, and its descriptor lives and dies with its
//! transaction.
//!
//! WHY live: `lo_*` are statements only a server can run, and the property that
//! matters — that the transaction is what commits the bytes — is the server's, not
//! a value a stand-in could hold. The suite runs when `CMS_DB_TEST_URL` names a
//! scratch database and skips otherwise.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test large_object

use std::io::SeekFrom;

use cms_db::{LargeObject, LargeObjectError, Mode, SessionConfig};

const URL_ENV: &str = "CMS_DB_TEST_URL";

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

#[test]
fn the_bytes_a_writer_closed_are_read_back_by_a_reader() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut writer = LargeObject::create(&config, Mode::WRITE)
            .await
            .expect("creating the object");
        let loid = writer.loid();
        assert_ne!(loid, 0, "lo_create handed back the no-object sentinel");

        assert_eq!(
            writer.write(b"the quick brown fox").await.expect("writing"),
            19
        );
        writer.close().await.expect("closing the writer");

        // The bytes are visible only because close committed them: the property kept.
        let mut reader = LargeObject::open(&config, loid, Mode::READ)
            .await
            .expect("opening the object");
        let mut buffer = [0_u8; 64];
        let read = reader.read(&mut buffer).await.expect("reading");
        assert_eq!(&buffer[..read], b"the quick brown fox");
        assert_eq!(reader.read(&mut buffer).await.expect("reading on"), 0);
        reader.close().await.expect("closing the reader");

        LargeObject::unlink(&config, loid).await.expect("unlinking");
    });
}

#[test]
fn seek_tell_and_truncate_move_inside_the_object() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut object = LargeObject::create(&config, Mode::READ_WRITE)
            .await
            .expect("creating the object");
        let loid = object.loid();
        object.write(b"0123456789").await.expect("writing");
        assert_eq!(object.tell().await.expect("telling"), 10);

        assert_eq!(object.seek(SeekFrom::Start(4)).await.expect("seeking"), 4);
        object.write(b"abc").await.expect("overwriting");
        assert_eq!(
            object
                .seek(SeekFrom::End(0))
                .await
                .expect("seeking to the end"),
            10
        );
        assert_eq!(object.truncate(Some(5)).await.expect("truncating"), 5);
        object.close().await.expect("closing the writer");

        let mut reader = LargeObject::open(&config, loid, Mode::READ)
            .await
            .expect("opening the object");
        let mut buffer = [0_u8; 16];
        let read = reader.read(&mut buffer).await.expect("reading");
        assert_eq!(&buffer[..read], b"0123a");
        reader.close().await.expect("closing the reader");

        LargeObject::unlink(&config, loid).await.expect("unlinking");
    });
}

#[test]
fn a_mode_refuses_the_operations_it_does_not_allow() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut writer = LargeObject::create(&config, Mode::WRITE)
            .await
            .expect("creating the object");
        let loid = writer.loid();
        let mut buffer = [0_u8; 4];
        assert!(matches!(
            writer.read(&mut buffer).await,
            Err(LargeObjectError::NotReadable { loid: found }) if found == loid
        ));
        writer.close().await.expect("closing the writer");

        let mut reader = LargeObject::open(&config, loid, Mode::READ)
            .await
            .expect("opening the object");
        assert!(matches!(
            reader.write(b"x").await,
            Err(LargeObjectError::NotWritable { loid: found }) if found == loid
        ));
        reader.close().await.expect("closing the reader");

        LargeObject::unlink(&config, loid).await.expect("unlinking");
    });
}

#[test]
fn an_unlinked_object_cannot_be_opened_again() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut writer = LargeObject::create(&config, Mode::WRITE)
            .await
            .expect("creating the object");
        let loid = writer.loid();
        writer.write(b"gone").await.expect("writing");
        writer.close().await.expect("closing the writer");

        LargeObject::unlink(&config, loid).await.expect("unlinking");

        assert!(matches!(
            LargeObject::open(&config, loid, Mode::READ).await,
            Err(LargeObjectError::Open { loid: found, .. }) if found == loid
        ));
    });
}

#[test]
fn a_writer_dropped_without_close_leaves_nothing_behind() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut writer = LargeObject::create(&config, Mode::WRITE)
            .await
            .expect("creating the object");
        let loid = writer.loid();
        writer.write(b"never committed").await.expect("writing");
        drop(writer);

        // The transaction died with the connection, as a psycopg2 close left it.
        assert!(LargeObject::open(&config, loid, Mode::READ).await.is_err());
    });
}
