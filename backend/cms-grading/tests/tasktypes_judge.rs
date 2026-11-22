//! The judge over an answer that is a file: a white diff, and the answer that is not
//! there at all.
//!
//! Two distinctions are the whole of this file, because they are what a contestant
//! feels: a white diff decides both directions, and an answer the run never wrote is a
//! wrong answer rather than a failed check. A link to an existing answer is the second
//! of those, because the reference treats links as potential attacks.

#[path = "judge_helpers.rs"]
mod judge;

use std::os::unix::fs::symlink;
use std::path::Path;
use std::str::FromStr;

use cms_grading::scoretypes::format_status_text;
use cms_grading::stage::FileDigest;
use cms_grading::tasktypes::{Judgement, OutputSource, TaskError};

use judge::{
    check_box_made, diffed, job, judged, workspace, written, ANSWER_FILENAME, CHECKER, SCORED,
    SOURCE_DIGEST,
};

#[test]
fn a_white_diff_decides_both_the_answer_that_is_right_and_the_one_that_is_not() {
    let right = workspace("judge-diff-right");
    let same = diffed(&right, b"the source");
    assert!(same.success);
    assert_eq!(same.outcome, Some(1.0));
    assert_eq!(same.text, vec!["Output is correct"]);
    assert!(
        same.sandboxes.is_empty(),
        "a white diff makes no box of its own"
    );

    let wrong = workspace("judge-diff-wrong");
    let differs = diffed(&wrong, b"the answer");
    assert!(differs.success);
    assert_eq!(differs.outcome, Some(0.0));
    assert_eq!(differs.text, vec!["Output isn't correct"]);
}

#[test]
fn an_answer_that_was_never_written_is_a_wrong_answer_and_not_a_failed_check() {
    let dir = workspace("judge-unwritten");

    let judged = missing_answer(&dir);

    assert!(
        judged.success,
        "a missing file is the submission's fault, not the checker's"
    );
    assert_eq!(judged.outcome, Some(0.0));
    assert_eq!(
        judged.text,
        vec!["Evaluation didn't produce file %s", ANSWER_FILENAME],
        "the sentence carries the filename as its one argument"
    );
    assert_eq!(
        format_status_text(&judged.text),
        format!("Evaluation didn't produce file {ANSWER_FILENAME}"),
        "and the contestant is shown the file rather than a %s"
    );
    assert!(
        !check_box_made(&dir),
        "the answer is known to be missing before a checker is ever run"
    );
}

#[test]
fn a_link_to_an_existing_answer_is_treated_exactly_like_a_missing_one() {
    let missing_dir = workspace("judge-link-missing");
    let missing = missing_answer(&missing_dir);

    let linked_dir = workspace("judge-link");
    let real = written(&linked_dir, b"the source");
    let link = linked_dir.join("linked.txt");
    symlink(&real, &link).expect("a link to an existing answer");
    let through_link = judged(
        &linked_dir,
        &job(true),
        Some(CHECKER),
        OutputSource::Path(link),
        SCORED,
    )
    .expect("a link is judged like any other path");

    assert_eq!(
        through_link, missing,
        "the reference treats a link as a potential attack, so it is no answer at all"
    );
    assert_eq!(
        through_link.outcome,
        Some(0.0),
        "and the answer it pointed at is not read"
    );
}

#[test]
fn an_answer_named_by_both_a_path_and_a_digest_or_by_neither_is_refused() {
    let dir = workspace("judge-source");
    let path = written(&dir, b"the answer");
    let digest = FileDigest::from_str(SOURCE_DIGEST).expect("a digest the domain admits");

    assert!(matches!(
        OutputSource::of(Some(path.clone()), Some(digest.clone())),
        Err(TaskError::OutputSource)
    ));
    assert!(matches!(
        OutputSource::of(None, None),
        Err(TaskError::OutputSource)
    ));
    assert!(matches!(
        OutputSource::of(Some(path), None),
        Ok(OutputSource::Path(named)) if named == dir.join(ANSWER_FILENAME)
    ));
    assert!(matches!(
        OutputSource::of(None, Some(digest.clone())),
        Ok(OutputSource::Digest(named)) if named == digest
    ));
}

/// The judgement of an answer that is not there, by a dataset holding a checker that
/// would otherwise have read it: if the file were read, the checker would have scored it.
fn missing_answer(dir: &Path) -> Judgement {
    judged(
        dir,
        &job(true),
        Some(CHECKER),
        OutputSource::Path(dir.join(ANSWER_FILENAME)),
        SCORED,
    )
    .expect("a file that is not there is a verdict")
}
