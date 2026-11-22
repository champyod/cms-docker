//! The two permission bits `lo_open` reads, and the three modes they can mean.
//!
//! The reference validated a mode string for the characters `r`, `w` and `b` and for
//! the mandatory `b`; the three combinations that survived are the constants below.
//! A Rust stream carries bytes, so there is no text mode for `b` to refuse.

/// libpq's `INV_READ`, unpublished by psycopg2 and restated here for the same reason.
const INV_READ: i32 = 0x0004_0000;

/// libpq's `INV_WRITE`.
const INV_WRITE: i32 = 0x0002_0000;

/// How a large object is opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mode {
    readable: bool,
    writable: bool,
}

impl Mode {
    /// Read only, the reference's `'rb'`.
    pub const READ: Self = Self {
        readable: true,
        writable: false,
    };
    /// Write only, the reference's `'wb'`.
    pub const WRITE: Self = Self {
        readable: false,
        writable: true,
    };
    /// Both, the reference's `'rwb'`.
    pub const READ_WRITE: Self = Self {
        readable: true,
        writable: true,
    };

    /// Whether reads are permitted.
    #[must_use]
    pub const fn is_readable(self) -> bool {
        self.readable
    }

    /// Whether writes are permitted.
    #[must_use]
    pub const fn is_writable(self) -> bool {
        self.writable
    }

    /// The mask `lo_open` reads.
    pub(super) const fn bits(self) -> i32 {
        let mut bits = 0;
        if self.readable {
            bits |= INV_READ;
        }
        if self.writable {
            bits |= INV_WRITE;
        }
        bits
    }
}
