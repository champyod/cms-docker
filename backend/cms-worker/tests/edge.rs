//! The file a job cannot have, the flags that refusal is reported with, and what
//! a request cost the worker.
//!
//! Nothing is launched and nothing is waited for: a job's work is a closure that
//! reads a handle, and a request's cost is two clock readings a test decided. A
//! digest is a real forty-digit lowercase one so the mapping is asked about a
//! digest and not about a string of the wrong shape.

use std::str::FromStr as _;

use cms_worker::edge::{
    content_digest, dispose, resolve_task_type, Accounting, JobError, JobResult,
};
use cms_worker::stage::{CacheHandle, FileDigest};

/// A digest of a file the store really holds, so a refusal is about the tombstone
/// and not about a handle the mapping would refuse anyway.
const STORED_DIGEST: &str = "0000000000000000000000000000000000000000";

/// The task types a worker's configuration gives it.
const AVAILABLE: [&str; 2] = ["batch", "interactive"];

/// The names a worker is configured with, as the lookup is handed them.
fn available() -> Vec<String> {
    AVAILABLE.iter().map(ToString::to_string).collect()
}

/// A handle naming the file whose content was dropped to recover space.
fn tombstone() -> CacheHandle {
    CacheHandle::new(FileDigest::tombstone())
}

/// A handle naming a file the store really holds.
fn stored() -> CacheHandle {
    let digest = FileDigest::from_str(STORED_DIGEST).expect("a forty-digit digest is a digest");
    CacheHandle::new(digest)
}

#[test]
fn a_handle_naming_the_tombstone_is_refused_by_the_digest_mapping() {
    assert_eq!(content_digest(&tombstone()), Err(JobError::Tombstone));
    assert_eq!(
        content_digest(&stored()),
        Ok(stored().digest()),
        "a real digest is handed back for the job to read at"
    );
}

#[test]
fn a_job_stopped_by_the_tombstone_is_reported_unsuccessful_with_the_marker() {
    let reported = dispose(|| content_digest(&tombstone()).map(|_digest| ()));
    assert_eq!(reported, Ok(JobResult::REFUSED_BY_TOMBSTONE));
    let flags = reported.expect("the tombstone is a result and not a failure");
    assert!(!flags.success, "a job that read no content did not succeed");
    assert!(
        flags.tombstone,
        "the marker is what says the content is gone"
    );
}

#[test]
fn a_job_that_ran_to_the_end_reports_success_and_no_marker() {
    assert_eq!(dispose(|| Ok(())), Ok(JobResult::COMPLETED));
    let reported = dispose(|| content_digest(&stored()).map(|_digest| ()));
    let flags = reported.expect("a job that read its file is a result");
    assert!(flags.success);
    assert!(!flags.tombstone, "a stored file is not the tombstone");
}

#[test]
fn a_task_type_is_resolved_before_the_guard_so_an_unknown_one_is_raised_not_reported() {
    let configured = available();
    assert_eq!(resolve_task_type("batch", &configured), Ok("batch"));
    let unknown = JobError::UnknownTaskType {
        name: String::from("minimax"),
    };
    assert_eq!(
        resolve_task_type("minimax", &configured),
        Err(unknown.clone())
    );
    assert_eq!(
        dispose(|| Err(unknown.clone())),
        Err(unknown),
        "an unknown task type reaches the guard as a refusal, so it is raised and not marked"
    );
}

#[test]
fn the_first_line_reports_the_mean_of_the_line_it_closes() {
    let mut accounting = Accounting::new();
    let report = accounting.close(10.0, 12.0);
    assert_eq!(report.busy_seconds, 2.0);
    assert_eq!(
        report.free_seconds, 0.0,
        "there was no previous line to be idle after"
    );
    assert_eq!(report.busy_percent, Some(100.0), "a first line is all work");
    assert_eq!(
        report.mean_busy_seconds,
        Some(2.0),
        "the first mean is its own line"
    );
    assert_eq!(report.mean_free_seconds, Some(0.0));
}

#[test]
fn idle_is_the_gap_after_the_previous_request_and_the_means_cover_every_line() {
    let mut accounting = Accounting::new();
    accounting.close(10.0, 15.0);
    let report = accounting.close(25.0, 30.0);
    assert_eq!(report.busy_seconds, 5.0);
    assert_eq!(report.free_seconds, 10.0, "the gap between the two lines");
    assert_eq!(
        report.busy_percent,
        Some(50.0),
        "ten of twenty seconds worked"
    );
    assert_eq!(
        report.mean_busy_seconds,
        Some(5.0),
        "ten seconds over two lines"
    );
    assert_eq!(report.mean_free_seconds, Some(5.0));
}

#[test]
fn a_clock_with_nothing_measured_on_it_has_no_share_to_report() {
    let mut accounting = Accounting::new();
    let report = accounting.close(4.0, 4.0);
    assert_eq!(report.busy_seconds, 0.0);
    assert_eq!(
        report.busy_percent, None,
        "a share of an empty clock is not a number"
    );
    assert_eq!(report.mean_busy_seconds, Some(0.0));
}
