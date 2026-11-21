//! One advisory shape for every feed, plus the free-form detail bag.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Per-feed extras (`requiredAction`, `fixed`, `matches_ours`, …) kept as JSON.
pub type Detail = Map<String, Value>;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Advisory {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub url: String,
    /// Raw as the feed published it: display never reformats a vendor date.
    pub published: String,
    pub severity: String,
    pub score: Option<f64>,
    pub title: String,
    pub summary: String,
    pub cves: Vec<String>,
    pub products: Vec<String>,
    pub exploited: bool,
    pub detail: Detail,
    /// Filled in by ranking: which inventory keys this advisory touches.
    #[serde(default)]
    pub ours: Vec<String>,
    /// Filled in by ranking: not present in the seen-state.
    #[serde(default)]
    pub fresh: bool,
}

impl Advisory {
    pub fn new(
        id: impl Into<String>,
        kind: impl Into<String>,
        source: impl Into<String>,
        url: impl Into<String>,
        published: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind: kind.into(),
            source: source.into(),
            url: url.into(),
            published: published.into(),
            ..Self::default()
        }
    }

    pub fn detail_str(&self, key: &str) -> Option<&str> {
        self.detail.get(key).and_then(Value::as_str)
    }

    pub fn detail_list(&self, key: &str) -> Vec<String> {
        self.detail
            .get(key)
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
            .unwrap_or_default()
    }

    /// The one severity rule the whole brief shares.
    pub fn is_critical(&self) -> bool {
        self.exploited
            || self.score.unwrap_or(0.0) >= 9.0
            || self.severity.eq_ignore_ascii_case("critical")
    }

    /// "nginx, redis" or the honest fallback when no product matched.
    pub fn product_labels(&self) -> String {
        if self.products.is_empty() {
            "outside your stack".to_string()
        } else {
            self.products.join(", ")
        }
    }
}

/// Everything one collection pass read, still separated by feed.
#[derive(Debug, Clone, Default)]
pub struct Feeds {
    pub kev: Vec<Advisory>,
    pub usn: Vec<Advisory>,
    pub avg: Vec<Advisory>,
    pub ghsa: Vec<Advisory>,
    pub nvd: Vec<Advisory>,
    pub news: Vec<Advisory>,
    pub window_hours: u32,
}

impl Feeds {
    /// Feed order is fixed because merge order decides which source wins a duplicate.
    pub fn by_kind(&self, kind: &str) -> &[Advisory] {
        match kind {
            "kev" => &self.kev,
            "usn" => &self.usn,
            "avg" => &self.avg,
            "ghsa" => &self.ghsa,
            "nvd" => &self.nvd,
            "news" => &self.news,
            _ => &[],
        }
    }
}
