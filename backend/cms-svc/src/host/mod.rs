//! The server half of the RPC wire: a listener that answers calls to one service.

mod connection;
mod registry;

use std::fmt;
use std::io::{self, ErrorKind};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::thread::Builder;

use cms_proto::{GateConfig, Method};

pub use registry::{DuplicateMethod, Registry};

/// A listening host: the socket, and the shared table every connection is served from.
pub struct Host {
    listener: TcpListener,
    registry: Arc<Registry>,
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
        Ok(Self {
            listener,
            registry: Arc::new(registry),
        })
    }

    /// The address the listener holds, which is how a caller learns the port the kernel picked.
    pub fn local_addr(&self) -> Result<SocketAddr, HostError> {
        self.listener.local_addr().map_err(HostError::Address)
    }

    /// Accepts connections forever, one thread each; an accept or spawn failure returns here.
    pub fn run(&self) -> Result<(), HostError> {
        loop {
            let (stream, peer) = match self.listener.accept() {
                Ok(accepted) => accepted,
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => return Err(HostError::Accept(error)),
            };
            self.spawn(stream, peer)?;
        }
    }

    /// Hands one accepted connection to the thread that will serve it.
    fn spawn(&self, stream: TcpStream, peer: SocketAddr) -> Result<(), HostError> {
        let registry = Arc::clone(&self.registry);
        Builder::new()
            .name(format!("rpc-{}", peer.port()))
            .spawn(move || connection::serve(stream, &registry))
            .map(|_running| ())
            .map_err(HostError::Spawn)
    }
}

/// Why a host could not be bound, or stopped accepting.
#[derive(Debug)]
pub enum HostError {
    /// Two methods were registered under one name.
    Duplicate(DuplicateMethod),
    /// The address could not be listened on.
    Bind(io::Error),
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
            Self::Bind(error) | Self::Address(error) | Self::Accept(error) | Self::Spawn(error) => {
                Some(error)
            }
        }
    }
}
