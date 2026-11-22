//! The read-only half of `ResourceService.py`: what one sample says, keyed the way Python keys it.
//!
//! Process spawning and supervision are not here: starting a process is a different job from
//! looking at one, and only the looking is ported.

mod coord;
mod error;
mod machine;
mod matcher;
mod sample;
mod service;

pub use coord::{CoordError, LocalService, ServiceCoord};
pub use error::ResourceError;
pub use machine::{CpuPercentages, MemoryMegabytes};
pub use matcher::{interesting_command_line, Matched, ProcessMatcher};
pub use sample::{ProcessCpu, Sample, ServiceFigures, ServiceState, ServiceUsage};
pub use service::{ResourceService, Sampling, MAX_RESOURCE_SECONDS};
