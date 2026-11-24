//! One peer, kept up: the state machine a supervised connector owns.
//!
//! `RemoteServiceClient._run` keeps a connection to one peer up forever — it
//! dials, and on failure waits a capped, jittered interval and dials again,
//! probing more slowly once the outage lasts. That loop holds four numbers and
//! no owner, so a peer being dialed for the first time is indistinguishable
//! from one being retried, and a missing optional peer is faked with a client
//! that silently discards every call.
//!
//! [`Connector`] gives one peer a state to be in — [`PeerState`] — and refuses
//! to guess. A peer dialed for the first time, one waiting out a backoff, one
//! cooling down and one not present at all are four answers a caller can act
//! on, and only one of them ever reaches the transport. Nothing here opens a
//! socket: [`Dialer`] is the seam, so the whole machine runs against a
//! scripted transport and a clock the test owns.
//!
//! [`poll`](Connector::poll) takes the clock and the jitter as arguments, so
//! the host decides when a dial happens and no runtime is needed to decide it
//! twice.
//!
//! # Errors
//!
//! A peer being down is the case this module exists for, so a refused dial is
//! a state transition rather than an error the caller handles. What is
//! reported instead of swallowed: [`NoRoute`] from [`Connector::send`], which
//! separates a refusal to dial a peer from a refusal to queue on it, and
//! [`FrameError`] from [`of_frame`] and [`of_dispatch`], which drops a message
//! the frame or the dispatch layer could not correlate.
//!
//! The server half of the same wire is [`Host`]: it frames what arrives,
//! dispatches it, and writes the answer the gate produced.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod client;
mod connector;
mod host;
mod log;
mod resource;
mod resource_service;
pub mod service;

pub use client::{Client, ClientError};
pub use connector::{
    of_dispatch, of_frame, BackoffPolicy, Connector, DialError, Dialer, NoRoute, PeerSession,
    PeerState, ReconnectNotice, Send,
};
pub use host::{DuplicateMethod, Host, HostError, Registry, RunOutcome, Stop};
pub use log::{FormatterSettings, LogError, LogService, Record, RecordError};
pub use resource::{
    CpuTimes, ProcReader, ProcessFacts, ReadError, ResourceReader, SystemFacts, SystemMemory,
};
pub use resource_service::{
    all_services, daemon, handlers, interesting_command_line, local_services, ConnectorQuit,
    CoordError, CpuPercentages, LocalService, Matched, MemoryMegabytes, PeerQuit, ProcessCpu,
    ProcessMatcher, ProcessSpawner, QuitReceipt, ResourceError, ResourceService, RestartReport,
    Sample, Sampling, ServiceCommand, ServiceCoord, ServiceFigures, ServiceState, ServiceUsage,
    SpawnError, SpawnedChild, Spawner, TableError, MAX_RESOURCE_SECONDS, QUIT_REASON, QUIT_TIMEOUT,
};
