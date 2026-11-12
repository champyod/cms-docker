//! The run record: everything one run read and decided, as one document.
//!
//! Field names match the Python payload, so a record from either tool can be fed
//! to the same downstream reader.

use serde::{Deserialize, Serialize};

use crate::inventory::Inventory;
use crate::rank::{Sections, Stats};
use crate::render::BriefInput;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RunRecord {
    #[serde(default)]
    pub run_id: String,
    #[serde(default = "default_window")]
    pub window_hours: u32,
    #[serde(default)]
    pub inventory: Inventory,
    #[serde(default)]
    pub stats: Stats,
    #[serde(default)]
    pub sections: Sections,
    #[serde(default)]
    pub collector_errors: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
}

fn default_window() -> u32 {
    26
}

impl RunRecord {
    pub fn brief_input(&self) -> BriefInput<'_> {
        BriefInput {
            window_hours: self.window_hours,
            sections: &self.sections,
            stats: &self.stats,
            inventory: &self.inventory,
            collector_errors: &self.collector_errors,
        }
    }

    /// Empty is not a failure: it is "nothing new in this window".
    pub fn is_empty(&self) -> bool {
        self.sections.act_now.is_empty()
            && self.sections.watch.is_empty()
            && self.sections.industry.is_empty()
    }
}
