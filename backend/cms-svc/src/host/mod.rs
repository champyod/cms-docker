//! The server half of the RPC wire: a listener that answers calls to one service.

mod connection;
mod inflight;
mod registry;
mod stop;

use std::fmt;
use std::io::{self, ErrorKind};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::thread::{self, Builder};
use std::time::Duration;

use cms_proto::{GateConfig, Method};

use inflight::InFlight;

pub use registry::{DuplicateMethod, Registry};
pub use stop::Stop;

/// How long an empty accept waits before the loop looks for a stop again.
const ACCEPT_PAUSE: Duration = Duration::from_millis(5);

/// A listening host: the socket, the shared table every connection is served from, and its stop.
pub struct Host {
    listener: TcpListener,
    registry: Arc<Registry>,
    answers: Arc<InFlight>,
    stop: Stop,
}

impl Host {
    /// Binds the address, refusing a duplicate name or an unusable address; port zero asks the kernel.
    pub fn bind(
        addr: impl ToSocketAddrs,
        methods: Vec<Method>,
        config: GateConfig<'_>,
    ) -> Result<Self, HostError> {
        let registry = Registry::new(methods, config).map_err(HostError::Duplicate)?;
        let listener = TcpListener::bind(addr).map_err(HostError::Bind)?;
        // WHY: nothing in `std` interrupts a blocked accept, so the loop polls and reads a flag instead.
        listener
            .set_nonblocking(true)
            .map_err(HostError::NonBlocking)?;
        Ok(Self {
            listener,
            registry: Arc::new(registry),
            answers: Arc::new(InFlight::default()),
            stop: Stop::new(),
        })
    }

    /// The address the listener holds, which is how a caller learns the port the kernel picked.
    pub fn local_addr(&self) -> Result<SocketAddr, HostError> {
        self.listener.local_addr().map_err(HostError::Address)
    }

    /// A handle for the thread or handler that asks this host to stop.
    #[must_use]
    pub fn stop_handle(&self) -> Stop {
        self.stop.clone()
    }

    /// Accepts connections, one thread each, until a [`Stop`] is requested; then reports why it came back.
    ///
    /// A stop waits for the answers already underway, so a handler that stops the host
    /// still has its own reply written before the process can end.
    ///
    /// # Errors
    ///
    /// [`HostError::Accept`] when the listener stops accepting for a reason other than
    /// nothing being pending, and [`HostError::Spawn`] when a connection thread cannot start.
    pub fn run(&self) -> Result<RunOutcome, HostError> {
        loop {
            if self.stop.is_requested() {
                self.answers.wait_until_idle();
                return Ok(RunOutcome::of(&self.stop));
            }
            match self.listener.accept() {
                Ok((stream, peer)) => self.spawn(stream, peer)?,
                Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(ACCEPT_PAUSE),
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => return Err(HostError::Accept(error)),
            }
        }
    }

    /// Hands one accepted connection to the thread that will serve it.
    fn spawn(&self, stream: TcpStream, peer: SocketAddr) -> Result<(), HostError> {
        let registry = Arc::clone(&self.registry);
        let answers = Arc::clone(&self.answers);
        Builder::new()
            .name(format!("rpc-{}", peer.port()))
            .spawn(move || connection::serve(stream, &registry, &answers))
            .map(|_running| ())
            .map_err(HostError::Spawn)
    }
}

/// How [`Host::run`] came back, which is what the process's exit code is decided from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunOutcome {
    /// A plain stop, so the process may exit zero.
    Stopped,
    /// A stop that asked for a non-zero exit, so a supervisor restarts the service.
    StoppedFatally,
}

impl RunOutcome {
    /// Whether the process owes a non-zero exit.
    #[must_use]
    pub fn is_fatal(self) -> bool {
        matches!(self, Self::StoppedFatally)
    }

    /// Reads the exit the stop asked for.
    fn of(stop: &Stop) -> Self {
        if stop.is_fatal() {
            Self::StoppedFatally
        } else {
            Self::Stopped
        }
    }
}

/// Why a host could not be bound, or stopped accepting.
#[derive(Debug)]
pub enum HostError {
    /// Two methods were registered under one name.
    Duplicate(DuplicateMethod),
    /// The address could not be listened on.
    Bind(io::Error),
    /// The listener could not be made non-blocking, so a stop could not be observed.
    NonBlocking(io::Error),
    /// The listener could not report the address it is bound to.
    Address(io::Error),
    /// The listener stopped accepting connections.
    Accept(io::Error),
    /// A connection thread could not be started.
    Spawn(io::Error),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Duplicate(inner) => write!(f, "{inner}"),
            Self::Bind(error) => write!(f, "cannot bind the RPC listener: {error}"),
            Self::NonBlocking(error) => {
                write!(f, "cannot make the RPC listener non-blocking: {error}")
            }
            Self::Address(error) => write!(f, "cannot read the listener address: {error}"),
            Self::Accept(error) => write!(f, "the RPC listener stopped accepting: {error}"),
            Self::Spawn(error) => write!(f, "cannot start a connection thread: {error}"),
        }
    }
}

impl std::error::Error for HostError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Duplicate(inner) => Some(inner),
            Self::Bind(error)
            | Self::NonBlocking(error)
            | Self::Address(error)
            | Self::Accept(error)
            | Self::Spawn(error) => Some(error),
        }
    }
}
