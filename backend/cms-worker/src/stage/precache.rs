//! Precache: a walk over the files a contest names, in bounded ordered batches.
//!
//! `cms.service.Worker.precache_files` is the reference. It takes the shared
//! cache's precache lock, steps aside when another worker holds it, asks the
//! database for every digest the contest references, and fetches each one,
//! passing over a file that is not there because a file that cannot be found is
//! no problem at this stage. The tombstone never reaches the fetch at all: a
//! digest standing for content that was dropped is not a file to cache.
//!
//! The reference reads the whole set at once, out of one union query. This walks
//! it, a bounded batch at a time, ordered by the sequence that enumerated the
//! references and each one starting past the id the batch before ended at, so
//! the walk holds one batch whatever the contest holds. A reference added while
//! the walk is running is picked up when its id is higher and missed when it is
//! lower, which is the bargain the reference makes too: it says outright that a
//! race here is not dangerous, because this is only a cache.
//!
//! The lock is taken once and held for the whole walk, so it is held for every
//! batch fetched under it and a second worker on the same machine does not
//! repeat the work. Letting it go between batches would let two workers walk the
//! same contest at once, which an advisory operation gains nothing from.
//!
//! # Errors
//!
//! [`StageError`], and only that. An enumeration that cannot be read is
//! [`StageError::Store`], the one arm a backend reports in its own words, and so
//! is a store that refuses a fetch for a reason other than holding no content.
//! A digest no content store holds is [`StageError::NotStored`], and that is not
//! an error here: the reference swallows the `KeyError` it raises, and this
//! counts it instead of dropping it, so a caller can see how much of a contest
//! was reachable.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::Path;

use cms_db::{CacheHandle, FileDigest};

use super::{Cache, PrecacheLock, StageError};

/// The most references one batch of a walk fetches.
///
/// A bound in the code and not a setting: every worker precaches the same way,
/// and a contest does not get a longer list because a worker was told to.
pub const PRECACHE_BATCH: usize = 256;

/// One file a contest's enumeration named, and the sequence value the walk
/// resumes from after it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestEntry {
    /// The value the enumeration orders by, and the one the next batch is asked
    /// for past. It orders the walk rather than naming a file, so two references
    /// to the same file stand at two places in it.
    pub id: i32,
    /// The digest the file is addressed by. Holding a [`FileDigest`] rather than
    /// text is what validates the shape: a value the `DIGEST` domain would have
    /// refused cannot be built, so no fetch is ever handed one.
    pub digest: FileDigest,
}

/// A contest's file references, read one bounded batch at a time.
///
/// A source behind it is the enumeration query over the contest's tasks, and
/// this is the whole of what a walk asks of it: the next page of references, and
/// the cursor to ask the page after that from.
pub trait DigestWalk {
    /// The references that follow `after`, in `id` order, at most
    /// [`PRECACHE_BATCH`] of them.
    ///
    /// `after` is `None` for the first page and the last `id` of the page before
    /// for every page after it, so a page is read as "everything past this",
    /// which is what keeps a reference added between two pages from shifting the
    /// ones behind it. A page that comes back short is the last one.
    ///
    /// # Errors
    ///
    /// [`StageError::Store`] when the enumeration could not be read at all. A
    /// page that does not end past `after` breaks the contract above and ends
    /// the walk, because a source that ignored the cursor would be asked the
    /// same question for ever.
    fn next_batch(&self, after: Option<i32>) -> Result<Vec<DigestEntry>, StageError>;
}

/// What one precache walk fetched, and what it could not reach.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PrecacheReport {
    /// The batches the walk asked for, which is what it cost in queries.
    pub batches: usize,
    /// The files the cache held, or now holds, once the walk was over.
    pub fetched: usize,
    /// The files no content store held, each passed over as the reference passes
    /// over a file it cannot find.
    pub skipped: usize,
}

/// Fetches every file a contest's enumeration names into `cache`.
///
/// `cache_dir` is the shared cache directory the precache lock is taken on, and
/// `Ok(None)` is the reference's step-aside: another worker is already
/// precaching, so this one has nothing to do and asks the enumeration nothing.
///
/// # Errors
///
/// Whatever [`PrecacheLock::take`] refuses with for the lock file,
/// [`StageError::Store`] when the enumeration cannot be read, and whatever a
/// store refuses a fetch with other than having no content under a digest.
pub fn precache<W: DigestWalk + ?Sized>(
    walk: &W,
    cache: &dyn Cache,
    cache_dir: &Path,
) -> Result<Option<PrecacheReport>, StageError> {
    let Some(lock) = PrecacheLock::take(cache_dir)? else {
        return Ok(None);
    };
    let report = walk_batches(walk, cache)?;
    lock.release()?;
    Ok(Some(report))
}

/// Walks the enumeration a batch at a time until a page comes back short, and
/// fetches what each of those batches names.
fn walk_batches<W: DigestWalk + ?Sized>(
    walk: &W,
    cache: &dyn Cache,
) -> Result<PrecacheReport, StageError> {
    let mut report = PrecacheReport::default();
    let mut seen: Option<i32> = None;
    let mut batch = walk.next_batch(seen)?;
    while !batch.is_empty() {
        let before = seen;
        fetch_batch(&batch, cache, &mut report)?;
        seen = batch.last().map(|entry| entry.id);
        report.batches += 1;
        if !continues(before, &batch) {
            break;
        }
        batch = walk.next_batch(seen)?;
    }
    Ok(report)
}

/// Fetches what one batch names, passing over the tombstone, which is not a file
/// to cache, and counting a digest no content store holds rather than refusing
/// the walk over it.
fn fetch_batch(
    batch: &[DigestEntry],
    cache: &dyn Cache,
    report: &mut PrecacheReport,
) -> Result<(), StageError> {
    for entry in batch {
        if entry.digest.is_tombstone() {
            continue;
        }
        match cache.get_file(&CacheHandle::new(entry.digest.clone())) {
            Ok(_) => report.fetched += 1,
            Err(StageError::NotStored { .. }) => report.skipped += 1,
            Err(refusal) => return Err(refusal),
        }
    }
    Ok(())
}

/// Whether a batch is worth asking the next page after. `before` is the id the
/// page before ended at: a page that came back short is the last one, and a full
/// page that does not end past `before` is a source that ignored the cursor and
/// would be asked the same question for ever.
fn continues(before: Option<i32>, batch: &[DigestEntry]) -> bool {
    batch.len() == PRECACHE_BATCH && batch.last().map(|entry| entry.id) != before
}
