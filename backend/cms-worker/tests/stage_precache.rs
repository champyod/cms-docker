//! A walk over the files a contest names, in bounded ordered batches.
//!
//! Every test builds its own enumeration out of digest fixtures and its own cache
//! that records what it was asked for, so what is checked is the walk itself.

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr as _;

use cms_worker::stage::{
    precache, Cache, CacheHandle, DigestEntry, DigestWalk, FileDigest, PrecacheLock,
    PrecacheReport, StageError, PRECACHE_BATCH,
};

/// The sequence a contest's references are numbered from, past every fixture's.
const FIRST_ID: i32 = 100;

/// A directory of its own for one test, removed when the test ends, which is the
/// shared cache directory a precache lock is taken on.
struct Sandbox {
    path: PathBuf,
}

impl Sandbox {
    /// A sandbox of its own, which no other test is using.
    fn new(label: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("cms-precache-{label}-{}", std::process::id()));
        fs::create_dir(&path).expect("a sandbox of its own must not be there yet");
        Self { path }
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// The digest a fixture's nth reference is addressed by.
fn digest_of(index: u32) -> FileDigest {
    FileDigest::from_str(&format!("{index:040x}")).expect("a digest the domain admits")
}

/// The digests a fixture's references are addressed by, in the same order.
fn named(indices: &[u32]) -> Vec<String> {
    indices
        .iter()
        .map(|index| digest_of(*index).as_str().to_owned())
        .collect()
}

/// A contest's references, read the way the walk asks for them.
struct Fixture {
    entries: Vec<DigestEntry>,
    cursors: RefCell<Vec<Option<i32>>>,
}

impl Fixture {
    /// A contest of exactly these references, each pair its id and the number its
    /// digest is made of.
    fn of(references: &[(i32, u32)]) -> Self {
        let entries = references
            .iter()
            .map(|(id, index)| DigestEntry {
                id: *id,
                digest: digest_of(*index),
            })
            .collect();
        Self {
            entries,
            cursors: RefCell::new(Vec::new()),
        }
    }

    /// A contest of `count` references numbered from [`FIRST_ID`] with no gaps.
    fn counting(count: usize) -> Self {
        let references: Vec<(i32, u32)> = (0..count)
            .map(|index| (FIRST_ID + index as i32, index as u32))
            .collect();
        Self::of(&references)
    }
}

impl DigestWalk for Fixture {
    fn next_batch(&self, after: Option<i32>) -> Result<Vec<DigestEntry>, StageError> {
        self.cursors.borrow_mut().push(after);
        Ok(self
            .entries
            .iter()
            .filter(|entry| after.is_none_or(|id| entry.id > id))
            .take(PRECACHE_BATCH)
            .cloned()
            .collect())
    }
}

/// A cache that records what it was asked for and finds out whether the precache
/// lock is held as it answers, both behind a cell the shared reference allows.
struct Recording {
    held: BTreeSet<String>,
    asked: RefCell<Vec<String>>,
    locked: RefCell<Vec<bool>>,
    cache_dir: PathBuf,
}

impl Recording {
    /// A cache holding the content of every reference of `fixture`.
    fn holding_all(sandbox: &Sandbox, fixture: &Fixture) -> Self {
        let held = fixture
            .entries
            .iter()
            .map(|entry| entry.digest.as_str().to_owned())
            .collect();
        Self {
            held,
            asked: RefCell::new(Vec::new()),
            locked: RefCell::new(Vec::new()),
            cache_dir: sandbox.path.to_path_buf(),
        }
    }

    /// The same cache, with the content of one reference withheld from it.
    fn withholding(mut self, index: u32) -> Self {
        self.held.remove(digest_of(index).as_str());
        self
    }
}

impl Cache for Recording {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        let digest = handle.open()?;
        let held = PrecacheLock::take(&self.cache_dir)
            .expect("a lock file")
            .is_none();
        self.locked.borrow_mut().push(held);
        self.asked.borrow_mut().push(digest.as_str().to_owned());
        if !self.held.contains(digest.as_str()) {
            return Err(StageError::NotStored {
                digest: digest.clone(),
            });
        }
        Ok(Vec::new())
    }

    fn put_file(&self, _digest: &FileDigest, _content: &[u8]) -> Result<bool, StageError> {
        Ok(false)
    }
}

/// The walk a worker that found the cache free made.
fn walk(fixture: &Fixture, cache: &Recording, dir: &Path) -> PrecacheReport {
    precache(fixture, cache, dir)
        .expect("the lock file")
        .expect("a cache no other worker is precaching")
}

#[test]
fn every_reference_is_visited_once_and_the_walk_resumes_past_where_the_last_ended() {
    let sandbox = Sandbox::new("visit");
    let fixture = Fixture::of(&[(1, 40), (2, 41), (9, 42), (10, 43), (55, 44)]);
    let cache = Recording::holding_all(&sandbox, &fixture);
    let report = walk(&fixture, &cache, &sandbox.path);
    assert_eq!(
        cache.asked.borrow().as_slice(),
        named(&[40, 41, 42, 43, 44])
    );
    assert_eq!((report.batches, report.fetched, report.skipped), (1, 5, 0));
    let pages = fixture.cursors.borrow().len();
    assert_eq!(pages, 1, "one page held the whole contest");
}

#[test]
fn a_batch_is_bounded_and_the_next_one_asks_for_nothing_already_visited() {
    let sandbox = Sandbox::new("batches");
    let fixture = Fixture::counting(PRECACHE_BATCH + 3);
    let cache = Recording::holding_all(&sandbox, &fixture);
    let report = walk(&fixture, &cache, &sandbox.path);
    assert_eq!(
        report.batches, 2,
        "a full page and the short one that ended it"
    );
    assert_eq!(report.fetched, PRECACHE_BATCH + 3);
    assert_eq!(
        cache.asked.borrow().len(),
        PRECACHE_BATCH + 3,
        "each reference once"
    );
    assert_eq!(
        fixture.cursors.borrow().clone(),
        vec![None, Some(FIRST_ID + PRECACHE_BATCH as i32 - 1)],
        "the second page starts past the last id of the first"
    );
}

#[test]
fn the_tombstone_is_dropped_before_anything_is_fetched_for_it() {
    let sandbox = Sandbox::new("tombstone");
    let mut fixture = Fixture::of(&[(1, 50), (2, 51), (3, 52)]);
    fixture.entries[1].digest = FileDigest::tombstone();
    let cache = Recording::holding_all(&sandbox, &fixture);
    let report = walk(&fixture, &cache, &sandbox.path);
    assert_eq!(cache.asked.borrow().as_slice(), named(&[50, 52]));
    assert_eq!(
        (report.batches, report.fetched, report.skipped),
        (1, 2, 0),
        "the tombstone is neither fetched nor passed over"
    );
}

#[test]
fn a_reference_no_content_store_holds_is_passed_over_and_the_walk_carries_on() {
    let sandbox = Sandbox::new("missing");
    let fixture = Fixture::of(&[(1, 60), (2, 61), (3, 62)]);
    let cache = Recording::holding_all(&sandbox, &fixture).withholding(61);
    let report = walk(&fixture, &cache, &sandbox.path);
    assert_eq!(
        cache.asked.borrow().as_slice(),
        named(&[60, 61, 62]),
        "the walk came to all three"
    );
    assert_eq!((report.batches, report.fetched, report.skipped), (1, 2, 1));
}

#[test]
fn the_lock_is_held_for_every_batch_and_gives_the_next_worker_nothing_to_do() {
    let sandbox = Sandbox::new("held");
    let fixture = Fixture::counting(PRECACHE_BATCH + 1);
    let cache = Recording::holding_all(&sandbox, &fixture);
    walk(&fixture, &cache, &sandbox.path);
    assert_eq!(cache.locked.borrow().len(), PRECACHE_BATCH + 1);
    assert!(
        cache.locked.borrow().iter().all(|was_locked| *was_locked),
        "the cache was locked for every fetch"
    );
    let held = PrecacheLock::take(&sandbox.path)
        .expect("a lock file")
        .expect("the walk gave the lock back");
    let declined = precache(&fixture, &cache, &sandbox.path).expect("the lock file");
    assert!(declined.is_none(), "another worker is already precaching");
    assert_eq!(
        (cache.locked.borrow().len(), fixture.cursors.borrow().len()),
        (PRECACHE_BATCH + 1, 2),
        "a declined worker fetches and enumerates nothing"
    );
    held.release().expect("a released lock");
}
