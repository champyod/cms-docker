//! What a run leaves behind, kept as one archive under one digest: how it is
//! framed, when it is refused, and what the store is left holding.
//!
//! Every test here archives a directory of its own, and no isolation program is
//! involved in any of them: archiving reads the directory and asks the store, and
//! neither runs anything. The archives are read back as gzip streams and unpacked,
//! so a change to the packing is caught in the bytes rather than in a digest that
//! would change along with it.
//!
//! The store is a directory beside the sandbox, and the packed archive is read
//! back through the store rather than off the disk, so what each test claims is
//! what a run's archive is actually filed as.

use std::fs;

use cms_worker::sandbox::ArchiveError;

#[path = "sandbox_archive_helpers.rs"]
mod support;

use support::{
    box_with_output, filed, held, lowercase_hex, ARCHIVE_NAME, GZIP_MAGIC, REPETITIVE_LEN,
    REPETITIVE_NAME,
};

#[test]
fn the_archive_is_a_gzip_stream_filed_under_a_digest() {
    let (sandbox, stage, cache) = box_with_output("gzip");
    // Compression framing costs more than a few bytes, so what is measured here
    // is a payload long enough for compression to show at all.
    let repetitive = vec![b'x'; REPETITIVE_LEN];
    let wide = sandbox.home().join(REPETITIVE_NAME);
    fs::write(&wide, &repetitive).expect("the wide file must be writable");

    let digest = sandbox.archive(&stage).expect("the directory is there");

    assert_eq!(digest.as_str().len(), 40, "a digest is forty characters");
    assert!(lowercase_hex(digest.as_str()), "a digest is lowercase hex");
    let packed = filed(&cache, &digest);
    assert_eq!(&packed[..2], GZIP_MAGIC, "the archive must be gzip");
    let half = repetitive.len() / 2;
    assert!(
        packed.len() < half,
        "gzip of {} bytes must be under {half}",
        repetitive.len()
    );
}

#[test]
fn a_directory_archived_twice_is_filed_under_the_same_digest() {
    let (sandbox, stage, _cache) = box_with_output("twice");

    let first = sandbox.archive(&stage).expect("the first pack");
    let second = sandbox.archive(&stage).expect("the second pack");

    assert_eq!(first, second, "nothing changed, so the digest is the same");
}

#[test]
fn a_directory_that_is_not_there_is_a_named_refusal_and_nothing_is_filed() {
    let (sandbox, stage, cache) = box_with_output("missing");
    fs::remove_dir_all(sandbox.home()).expect("the run's own directory must go");

    let refused = sandbox
        .archive(&stage)
        .expect_err("a missing dir cannot pack");

    assert!(
        matches!(refused, ArchiveError::Io { .. }),
        "named: {refused}"
    );
    assert_eq!(held(&cache), 0, "a refused archive is never filed");
}

#[test]
fn a_file_where_the_packed_copy_goes_is_refused_rather_than_overwritten() {
    let (sandbox, stage, _cache) = box_with_output("taken");
    let taken = stage.path(ARCHIVE_NAME);
    let owned = b"the run's own file";
    fs::write(&taken, owned).expect("the file must be writable");

    let refused = sandbox
        .archive(&stage)
        .expect_err("an archive must not overwrite it");

    assert!(
        matches!(refused, ArchiveError::Store { .. }),
        "named: {refused}"
    );
    assert_eq!(fs::read(&taken).expect("the file is still there"), owned);
}
