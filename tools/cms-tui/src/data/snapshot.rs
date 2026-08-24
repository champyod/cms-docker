/// Point-in-time view of all dashboard data.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {}

impl Snapshot {
    pub fn empty() -> Self {
        Self {}
    }

    pub async fn collect() -> Self {
        Self {}
    }
}
