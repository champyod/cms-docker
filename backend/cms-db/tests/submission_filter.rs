//! The pairs a submission or result search refuses, and the pairs it admits.

use cms_db::{DatasetId, ResultFilter, SearchError, SubmissionFilter, SubmissionId};

/// A submission id the fixtures reuse.
fn submission_id() -> Option<SubmissionId> {
    Some(SubmissionId(41))
}

#[test]
fn every_single_criterion_is_accepted() {
    let filters = [
        SubmissionFilter {
            submission_id: submission_id(),
            ..SubmissionFilter::default()
        },
        SubmissionFilter {
            participation_id: Some(12),
            ..SubmissionFilter::default()
        },
        SubmissionFilter {
            task_id: Some(7),
            ..SubmissionFilter::default()
        },
        SubmissionFilter {
            contest_id: Some(3),
            ..SubmissionFilter::default()
        },
        SubmissionFilter::default(),
    ];

    for filter in filters {
        assert!(filter.validate().is_ok());
    }
}

#[test]
fn a_wider_criterion_beside_a_narrower_one_names_the_implier() {
    let cases = [
        (
            SubmissionFilter {
                task_id: Some(7),
                contest_id: Some(3),
                ..SubmissionFilter::default()
            },
            "contest_id",
            "task_id",
        ),
        (
            SubmissionFilter {
                participation_id: Some(12),
                contest_id: Some(3),
                ..SubmissionFilter::default()
            },
            "contest_id",
            "participation_id",
        ),
        (
            SubmissionFilter {
                submission_id: submission_id(),
                contest_id: Some(3),
                ..SubmissionFilter::default()
            },
            "contest_id",
            "submission_id",
        ),
        (
            SubmissionFilter {
                submission_id: submission_id(),
                task_id: Some(7),
                ..SubmissionFilter::default()
            },
            "task_id",
            "submission_id",
        ),
        (
            SubmissionFilter {
                submission_id: submission_id(),
                participation_id: Some(12),
                ..SubmissionFilter::default()
            },
            "participation_id",
            "submission_id",
        ),
    ];

    for (filter, field, implied_by) in cases {
        assert!(
            matches!(
                filter.validate(),
                Err(SearchError::Superfluous { field: found, implied_by: by })
                    if found == field && by == implied_by
            ),
            "{filter:?} was not refused as {field} beneath {implied_by}"
        );
    }
}

#[test]
fn a_dataset_implies_its_task_and_its_contest_but_not_a_participation() {
    let beneath_task = ResultFilter {
        dataset_id: Some(DatasetId(9)),
        task_id: Some(7),
        ..ResultFilter::default()
    };
    let beneath_contest = ResultFilter {
        dataset_id: Some(DatasetId(9)),
        contest_id: Some(3),
        ..ResultFilter::default()
    };
    let beside_participation = ResultFilter {
        dataset_id: Some(DatasetId(9)),
        participation_id: Some(12),
        ..ResultFilter::default()
    };

    assert!(beneath_task.validate().is_err());
    assert!(beneath_contest.validate().is_err());
    assert!(beside_participation.validate().is_ok());
}
