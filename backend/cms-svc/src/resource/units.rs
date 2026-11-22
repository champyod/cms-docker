//! Conversions from the units `/proc` reports to the units the service reports.

/// Ticks per second: Linux fixes USER_HZ at 100, the same divisor psutil applies to `/proc` ticks.
pub(crate) const USER_HZ: u64 = 100;

/// Converts a cpu-time tick count to seconds, as `psutil.cpu_times()` reports it.
pub(crate) fn ticks_to_seconds(ticks: u64) -> f64 {
    ticks as f64 / USER_HZ as f64
}

/// Converts `statm` pages to bytes via `sysconf`, since `std` has no page size and `statm` cannot define its own.
pub(crate) fn pages_to_bytes(pages: u64) -> u64 {
    pages * procfs::page_size()
}

#[cfg(test)]
mod tests {
    use super::{pages_to_bytes, ticks_to_seconds, USER_HZ};

    #[test]
    fn ticks_become_seconds() {
        assert_eq!(USER_HZ, 100);
        assert_eq!(ticks_to_seconds(0), 0.0);
        assert_eq!(ticks_to_seconds(100), 1.0);
        assert_eq!(ticks_to_seconds(250), 2.5);
    }

    #[test]
    fn pages_become_bytes() {
        assert_eq!(pages_to_bytes(0), 0);
        assert_eq!(pages_to_bytes(1), procfs::page_size());
        assert_eq!(pages_to_bytes(3), 3 * procfs::page_size());
    }
}
