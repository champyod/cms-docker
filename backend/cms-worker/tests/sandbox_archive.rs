//! What a run leaves behind, kept as one archive under one digest.
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
//!
//! The stage is the run's own directory, which is the layout a run is handed, so
//! the packed copy lands inside the very directory the walk read and is gone from
//! it again before any later walk of that directory could pack it once more.

use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use cms_worker::sandbox::{ArchiveError, Sandbox};
use cms_worker::stage::{Cache, CacheHandle, FileDigest, FsCache, Stage};

use flate2::read::GzDecoder;

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::stub;

/// What a run leaves in its own directory, at the top and one level down.
const GRADED_OUTPUT: &[u8] = b"one graded answer\n";
const OUTPUT_NAME: &str = "grader.out";
const NESTED_NAME: &str = "sub/table.txt";
const NESTED_CONTENT: &[u8] = b"nested table\n";

/// A file of one byte repeated, which is what a compressor is measured against.
const REPETITIVE_NAME: &str = "repetitive.bin";
const REPETITIVE_LEN: usize = 64 * 1024;

/// The two bytes every gzip stream begins with: the magic number, then the method.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// The name the run's own directory is archived under, which is its own name.
const HOME_NAME: &str = "home";

/// The name the packed copy is written under inside the stage.
const ARCHIVE_NAME: &str = "sandbox-archive.tar.gz";

/// What one of these directories holds at a path inside the archive.
fn at(name: &str) -> String {
    format!("{HOME_NAME}/{name}")
}

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
fn the_archive_holds_the_run_directory_under_its_own_name() {
    let (sandbox, stage, cache) = box_with_output("listing");

    let listed = names(&pack(&sandbox, &stage, &cache));
    let wanted = format!("{HOME_NAME}/");

    assert!(
        listed.iter().all(|n| n.starts_with(&wanted)),
        "under {wanted}: {listed:?}"
    );
    assert!(listed.contains(&at(OUTPUT_NAME)), "output: {listed:?}");
    assert!(listed.contains(&at(NESTED_NAME)), "nested file: {listed:?}");
    assert!(
        !listed.contains(&at(ARCHIVE_NAME)),
        "the archive never holds itself: {listed:?}"
    );
}

#[test]
fn what_the_archive_holds_is_what_the_run_left() {
    let (sandbox, stage, cache) = box_with_output("roundtrip");

    let packed = pack(&sandbox, &stage, &cache);

    assert_eq!(read(&packed, &at(OUTPUT_NAME)), GRADED_OUTPUT);
    assert_eq!(read(&packed, &at(NESTED_NAME)), NESTED_CONTENT);
}

#[test]
fn a_link_in_the_run_directory_is_archived_as_a_link_and_not_followed() {
    let (sandbox, stage, cache) = box_with_output("link");
    let inside = sandbox.home().join(OUTPUT_NAME);
    let link = sandbox.home().join("answer.link");
    let _ = fs::remove_file(&link);
    std::os::unix::fs::symlink(&inside, &link).expect("the link must be creatable");

    let packed = pack(&sandbox, &stage, &cache);

    assert!(
        read(&packed, &at("answer.link")).is_empty(),
        "a link holds no bytes"
    );
}

#[test]
fn nothing_is_left_behind_where_the_next_archive_would_pack_it_again() {
    let (sandbox, stage, _cache) = box_with_output("clean");

    let digest = sandbox.archive(&stage).expect("the directory is there");

    assert_eq!(
        stage.path(ARCHIVE_NAME),
        sandbox.home().join(ARCHIVE_NAME),
        "the stage is the run's own directory, so a copy kept there is packed again"
    );
    assert!(
        !sandbox.home().join(ARCHIVE_NAME).exists(),
        "the directory the archive was packed out of keeps no copy"
    );
    assert_eq!(digest.as_str().len(), 40, "a digest is forty characters");
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

/// A sandbox holding what a run would have left, and the store to file it in.
///
/// The stage is the run's own directory, which is the layout a run is handed,
/// so the packed copy is written into the directory the walk read.
fn box_with_output(test: &str) -> (Sandbox, Stage, PathBuf) {
    let dir = helpers::workspace(test);
    let executable = stub(&dir, "isolate", "#!/bin/sh\nexit 0\n");
    let sandbox = Sandbox::new(&executable, &dir, "box").expect("box uncreatable");
    let home = sandbox.home();
    fs::write(home.join(OUTPUT_NAME), GRADED_OUTPUT).expect("output unwritable");
    fs::create_dir(home.join("sub")).expect("subdir uncreatable");
    fs::write(home.join(NESTED_NAME), NESTED_CONTENT).expect("nested unwritable");
    let cache = dir.join("cache");
    let store = FsCache::at(&cache).expect("store uncreatable");
    let stage = Stage::at(home, Box::new(store)).expect("stage uncreatable");
    (sandbox, stage, cache)
}

/// The archive a sandbox packed and the store took, read back through the store.
fn pack(sandbox: &Sandbox, stage: &Stage, cache: &Path) -> Vec<u8> {
    let digest = sandbox.archive(stage).expect("the directory is there");
    filed(cache, &digest)
}

/// The bytes the store answers with for a digest, read back through the store
/// rather than off the disk, so the archive is proved to have been filed.
fn filed(cache: &Path, digest: &FileDigest) -> Vec<u8> {
    let store = FsCache::at(cache).expect("store unreadable");
    let handle = CacheHandle::new(digest.clone());
    store.get_file(&handle).expect("the store must answer")
}

/// How many files the store holds, which is what an unfilled store is.
fn held(cache: &Path) -> usize {
    fs::read_dir(cache).expect("store unreadable").count()
}

/// Whether a text is forty lowercase hexadecimal digits, which is a digest.
fn lowercase_hex(text: &str) -> bool {
    let digits = text
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
    text.len() == 40 && digits
}

/// Every path a packed archive lists, in the order the archive holds them.
fn names(packed: &[u8]) -> Vec<String> {
    let mut archive = tar::Archive::new(GzDecoder::new(packed));
    let listed = archive.entries().expect("unreadable archive");
    listed
        .map(|entry| named(&entry.expect("unreadable entry")))
        .collect()
}

/// The path one entry is archived under.
fn named(entry: &tar::Entry<GzDecoder<&[u8]>>) -> String {
    entry
        .path()
        .expect("an entry names a path")
        .to_string_lossy()
        .into_owned()
}

/// What the archive holds at one path, unpacked from the packed bytes.
fn read(packed: &[u8], wanted: &str) -> Vec<u8> {
    let mut archive = tar::Archive::new(GzDecoder::new(packed));
    for entry in archive.entries().expect("unreadable archive") {
        let mut entry = entry.expect("unreadable entry");
        if named(&entry) != wanted {
            continue;
        }
        let mut content = Vec::new();
        entry.read_to_end(&mut content).expect("unreadable entry");
        return content;
    }
    panic!("the archive must hold {wanted}")
}
