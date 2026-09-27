//! The files a run is handed, and the store a result of that run goes to.
//!
//! Every stage is rooted in a directory of its own under the system temporary
//! directory, and every store is a directory of its own beside it, so nothing
//! here reads or writes outside what the test made, and a digest is a real
//! SHA-1 of the content it is checked against.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::str::FromStr as _;
use std::sync::atomic::{AtomicU64, Ordering};

use cms_worker::stage::{
    Cache, CacheError, CacheHandle, DatabaseCache, FileDigest, FsCache, LargeObjects, NullCache,
    PrecacheLock, Stage, StageError, DEFAULT_READ_LIMIT, MODE_EXECUTABLE, MODE_PLAIN,
};

/// The content the tests store, and the digest a SHA-1 of it gives.
const GRADED_ANSWER: &[u8] = b"one graded answer";
const GRADED_ANSWER_DIGEST: &str = "99dd35c250ee452ec3e6c5c826c11855e01b5be6";

/// A digest nothing has stored, so a refusal is about the store and not the data.
const UNSTORED_DIGEST: &str = "0000000000000000000000000000000000000000";

/// The permission bits a mode is made of, which is what a mode is read as.
const MODE_MASK: u32 = 0o777;

/// What the sandboxes of one run of the suite are named apart by.
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A directory of its own for one test, removed when the test ends.
struct Sandbox {
    path: PathBuf,
}

impl Sandbox {
    /// A sandbox of its own, which no other test is using.
    fn new(label: &str) -> Self {
        let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!("cms-stage-{label}-{}-{sequence}", std::process::id());
        let path = std::env::temp_dir().join(name);
        fs::create_dir(&path).expect("a sandbox of its own must not be there yet");
        Self { path }
    }

    /// The directory the sandbox holds.
    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// The large objects a database-backed store keeps its content in, held in one
/// test's own memory: nothing here is shared between threads.
#[derive(Default)]
struct Memory {
    objects: RefCell<BTreeMap<String, Vec<u8>>>,
}

impl LargeObjects for Memory {
    fn get(&self, digest: &str) -> Result<Option<Vec<u8>>, StageError> {
        Ok(self.objects.borrow().get(digest).cloned())
    }

    fn put(&self, digest: &str, content: &[u8]) -> Result<bool, StageError> {
        let mut held = self.objects.borrow_mut();
        let stored = held.insert(digest.to_owned(), content.to_vec());
        Ok(stored.is_none())
    }
}

/// The backend that keeps nothing, as a store a stage can be built over.
fn null_cache() -> Box<dyn Cache> {
    Box::new(NullCache)
}

/// The two backends that keep content, each over a store of its own.
fn keeping_backends(sandbox: &Sandbox) -> Vec<Box<dyn Cache>> {
    let store = FsCache::at(sandbox.path().join("store")).expect("a store directory");
    vec![
        Box::new(store),
        Box::new(DatabaseCache::new(Memory::default())),
    ]
}

/// The three backends, each over a store of its own inside the sandbox.
fn backends(sandbox: &Sandbox) -> Vec<Box<dyn Cache>> {
    let mut every = keeping_backends(sandbox);
    every.push(null_cache());
    every
}

/// A stage over a directory of its own inside the sandbox.
fn stage_in(sandbox: &Sandbox, cache: Box<dyn Cache>) -> Stage {
    Stage::at(sandbox.path().join("run"), cache).expect("a stage directory")
}

/// A handle for a digest the domain admits.
fn handle(digest: &str) -> CacheHandle {
    CacheHandle::new(FileDigest::from_str(digest).expect("a digest the domain admits"))
}

/// The permissions a staged file ended up with.
fn mode_of(stage: &Stage, relative: &str) -> u32 {
    let metadata = fs::metadata(stage.path(relative)).expect("a staged file to look at");
    metadata.permissions().mode() & MODE_MASK
}

#[test]
fn a_path_the_run_already_has_is_refused() {
    let sandbox = Sandbox::new("refused");
    let stage = stage_in(&sandbox, null_cache());
    stage.create("manager.cfg", false).expect("a first create");
    let refused = stage
        .create("manager.cfg", false)
        .expect_err("not exclusive");
    assert!(
        matches!(refused, StageError::AlreadyExists { .. }),
        "{refused}"
    );
    assert!(refused.to_string().contains("manager.cfg"), "{refused}");
}

#[test]
fn a_plain_file_is_given_to_everyone_and_an_executable_to_run() {
    let sandbox = Sandbox::new("modes");
    let stage = stage_in(&sandbox, null_cache());
    stage
        .write("manager.cfg", b"gcc -O2\n", false)
        .expect("a file");
    stage
        .write("program", b"#!/bin/sh\n", true)
        .expect("a file");
    assert_eq!(mode_of(&stage, "manager.cfg"), MODE_PLAIN);
    assert_eq!(mode_of(&stage, "program"), MODE_EXECUTABLE);
}

#[test]
fn a_file_the_store_holds_is_written_into_the_run_under_the_mode_it_runs_with() {
    let sandbox = Sandbox::new("from-storage");
    let store = FsCache::at(sandbox.path().join("store")).expect("a store directory");
    let stored = handle(GRADED_ANSWER_DIGEST);
    store
        .put_file(stored.digest(), GRADED_ANSWER)
        .expect("a store");
    let stage = stage_in(&sandbox, Box::new(store));
    stage
        .write_from_storage("program", &stored, true)
        .expect("written");
    let copy = stage.read("program", None).expect("the run's copy");
    assert_eq!(copy, GRADED_ANSWER);
    assert_eq!(mode_of(&stage, "program"), MODE_EXECUTABLE);
}

#[test]
fn a_read_answers_the_whole_file_and_stops_where_it_is_told_to() {
    let sandbox = Sandbox::new("read");
    let stage = stage_in(&sandbox, null_cache());
    let printed = vec![b'x'; DEFAULT_READ_LIMIT * 2];
    stage.write("stdout.txt", &printed, false).expect("a file");
    let capped = stage
        .read("stdout.txt", Some(DEFAULT_READ_LIMIT))
        .expect("a capped read");
    assert_eq!(capped, printed[..DEFAULT_READ_LIMIT].to_vec());
    let whole = stage.read("stdout.txt", None).expect("a whole read");
    assert_eq!(whole, printed);
}

#[test]
fn a_stored_file_answers_the_digest_it_was_stored_under() {
    let sandbox = Sandbox::new("store");
    let store = FsCache::at(sandbox.path().join("store")).expect("a store directory");
    let stage = stage_in(&sandbox, Box::new(store.clone()));
    stage
        .write("answer.txt", GRADED_ANSWER, false)
        .expect("a staged answer");
    let digest = stage.store("answer.txt").expect("a stored answer");
    assert_eq!(digest.as_str(), GRADED_ANSWER_DIGEST);
    let kept = handle(GRADED_ANSWER_DIGEST);
    let content = store.get_file(&kept).expect("the stored content");
    assert_eq!(content, GRADED_ANSWER);
}

#[test]
fn the_tombstone_is_refused_by_every_backend_before_one_is_asked() {
    let sandbox = Sandbox::new("tombstone");
    let held = CacheHandle::new(FileDigest::tombstone());
    for backend in backends(&sandbox) {
        let refused = backend.get_file(&held).expect_err("no content");
        assert_eq!(refused, StageError::Cache(CacheError::Tombstone));
    }
}

#[test]
fn a_digest_no_backend_holds_is_reported_as_not_stored() {
    let sandbox = Sandbox::new("missing");
    let wanted = handle(UNSTORED_DIGEST);
    let unheld = StageError::NotStored {
        digest: wanted.digest().clone(),
    };
    for backend in backends(&sandbox) {
        let missing = backend.get_file(&wanted).expect_err("no content is held");
        assert_eq!(missing, unheld);
    }
}

#[test]
fn a_store_reports_whether_it_was_the_one_that_stored_the_content() {
    let sandbox = Sandbox::new("again");
    let digest = handle(GRADED_ANSWER_DIGEST);
    for backend in keeping_backends(&sandbox) {
        let first = backend
            .put_file(digest.digest(), GRADED_ANSWER)
            .expect("a first store");
        let second = backend
            .put_file(digest.digest(), GRADED_ANSWER)
            .expect("a second store");
        assert!(first, "the first store is the one that stored it");
        assert!(!second, "the content was already there");
        assert_eq!(backend.get_file(&digest).expect("kept"), GRADED_ANSWER);
    }
    let kept = null_cache()
        .put_file(digest.digest(), GRADED_ANSWER)
        .expect("a store that keeps nothing");
    assert!(!kept, "a store that keeps nothing stores nothing");
}

#[test]
fn the_precache_lock_is_held_by_one_at_a_time_and_freed_for_the_next() {
    let sandbox = Sandbox::new("lock");
    let taken = PrecacheLock::take(sandbox.path()).expect("a lock file");
    let held = taken.expect("a cache nobody is locking");
    let refused = PrecacheLock::take(sandbox.path()).expect("a second attempt");
    assert!(refused.is_none(), "a held lock returns at once");
    held.release().expect("a released lock");
    let third = PrecacheLock::take(sandbox.path()).expect("a third attempt");
    third.expect("the release freed the cache for the next process");
}
