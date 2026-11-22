//! The server half of the RPC wire: a listener that answers calls to one service.

mod registry;

pub use registry::{DuplicateMethod, Registry};
