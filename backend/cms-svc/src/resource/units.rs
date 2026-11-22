//! Conversions from the units `/proc` reports to the units the service reports.

/// Kernel clock ticks per second; Linux fixes it at 100 on every architecture.
///
/// WHY: `/proc/stat` and `/proc/<pid>/stat` count in USER_HZ ticks and psutil divides by 100, so
/// absolute create times and cpu seconds agree with the Python port only at the same constant.
pub(crate) const USER_HZ: u64 = 100;

/// Converts a cpu-time tick count to seconds, as `psutil.cpu_times()` reports it.
pub(crate) fn ticks_to_seconds(ticks: u64) -> f64 {
    ticks as f64 / USER_HZ as f64
}

#[cfg(test)]
mod tests {
    use super::{ticks_to_seconds, USER_HZ};

    #[test]
    fn ticks_become_seconds() {
        assert_eq!(USER_HZ, 100);
        assert_eq!(ticks_to_seconds(0), 0.0);
        assert_eq!(ticks_to_seconds(100), 1.0);
        assert_eq!(ticks_to_seconds(250), 2.5);
    }
}
