//! The read-only half of `ResourceService.py`: what one sample says, keyed the way Python keys it.
//!
//! Process spawning and supervision are not here: starting a process is a different job from
//! looking at one, and only the looking is ported.

mod coord;
mod sample;

pub use coord::{CoordError, LocalService, ServiceCoord};
pub use sample::{
    CpuPercentages, MemoryMegabytes, ProcessCpu, Sample, ServiceFigures, ServiceState, ServiceUsage,
};
