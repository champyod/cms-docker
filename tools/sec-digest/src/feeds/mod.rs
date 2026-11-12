//! Vendor feeds, normalized to one advisory shape.
//!
//! Each collector returns `Result<Feed, String>`. An error is not silence: it is
//! carried into the brief so a missing feed cannot look like "nothing happened".

pub mod kev;
pub mod news;
pub mod rss;
pub mod usn;

use chrono::{DateTime, Utc};

use crate::model::{Advisory, Feeds};

/// What one feed produced, and the reason it might be incomplete.
#[derive(Debug, Default)]
pub struct Feed {
    pub items: Vec<Advisory>,
    pub warning: Option<String>,
}

impl Feed {
    pub fn new(items: Vec<Advisory>) -> Self {
        Self { items, warning: None }
    }
}

/// Per-feed outcome, printed on stderr so a run shows what it actually read.
#[derive(Debug, Clone)]
pub struct FeedReport {
    pub name: &'static str,
    pub items: usize,
    pub problem: Option<String>,
}

impl FeedReport {
    pub fn failed(&self) -> bool {
        self.items == 0 && self.problem.is_some()
    }

    pub fn summary(&self) -> String {
        match &self.problem {
            None => format!("{} items", self.items),
            Some(problem) if self.items == 0 => format!("FAILED: {problem}"),
            Some(problem) => format!("{} items ({problem})", self.items),
        }
    }
}

fn absorb(
    slot: &mut Vec<Advisory>,
    reports: &mut Vec<FeedReport>,
    name: &'static str,
    result: Result<Feed, String>,
) {
    match result {
        Ok(feed) => {
            *slot = feed.items;
            reports.push(FeedReport {
                name,
                items: slot.len(),
                problem: feed.warning,
            });
        }
        Err(error) => {
            slot.clear();
            reports.push(FeedReport {
                name,
                items: 0,
                problem: Some(error),
            });
        }
    }
}

/// Collect every feed this build knows about, keeping failures as reports.
pub fn collect(since: DateTime<Utc>) -> (Feeds, Vec<FeedReport>) {
    let mut feeds = Feeds::default();
    let mut reports = Vec::new();
    absorb(&mut feeds.kev, &mut reports, "CISA KEV", kev::collect(since));
    absorb(&mut feeds.usn, &mut reports, "Ubuntu USN", usn::collect(since));
    absorb(&mut feeds.news, &mut reports, "News", Ok(news::collect(since)));
    (feeds, reports)
}
