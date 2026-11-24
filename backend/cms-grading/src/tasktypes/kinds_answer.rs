#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeSet;

use cms_proto::DigestMap;

use super::batch::SOURCE_PLACEHOLDER;
use super::batch_and_output::{Answer, Origin};
use super::judge::Judgement;
use super::output_only::{NOT_CARRIED, NO_CREDIT};
use super::Evaluation;
use crate::stage::FileDigest;

impl Answer {
    pub(super) fn carried(answer: FileDigest, kind: &'static str, judgement: Judgement) -> Self {
        Self {
            success: judgement.success,
            outcome: judgement.outcome,
            text: judgement.text,
            admin_text: judgement.admin_text,
            stats: None,
            sandboxes: judgement.sandboxes,
            sandbox_digests: judgement.sandbox_digests,
            origin: Some(Origin::Carried(answer)),
            ran: false,
            user_output: None,
            extra_args: vec![kind.to_owned()],
        }
    }

    pub(super) fn not_carried() -> Self {
        Self {
            success: true,
            outcome: Some(NO_CREDIT),
            text: vec![NOT_CARRIED.to_owned()],
            admin_text: None,
            stats: None,
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
            origin: None,
            ran: false,
            user_output: None,
            extra_args: Vec::new(),
        }
    }

    pub(super) fn from_run(mut run: Evaluation, kind: &'static str) -> Self {
        let origin = run.output_file.take().map(Origin::Written);
        let extra_args = if origin.is_some() {
            vec![kind.to_owned()]
        } else {
            Vec::new()
        };
        Self {
            success: run.success,
            outcome: run.outcome,
            text: run.text.unwrap_or_default(),
            admin_text: run.admin_text,
            stats: run.stats,
            sandboxes: run.sandboxes,
            sandbox_digests: run.sandbox_digests,
            origin,
            ran: run.ran,
            user_output: run.user_output,
            extra_args,
        }
    }
}

pub(super) fn listed(text: &str) -> BTreeSet<String> {
    text.split(',')
        .filter(|codename| !codename.is_empty())
        .map(str::to_owned)
        .collect()
}

pub(super) fn carries_source(files: &DigestMap) -> bool {
    files
        .keys()
        .any(|codename| codename.ends_with(SOURCE_PLACEHOLDER))
}
