//! The server half of the RPC wire: a listener that answers calls to one service.
//!
//! `RemoteServiceServer.run` reads one framed request at a time and writes the
//! answer the gate produced, dropping a message it cannot key a reply with. The
//! same shape is built here from a thread per connection: no runtime, a framer
//! owned by the connection, and a drop that closes instead of answering.

mod connection;
mod registry;

use std::fmt;
use std::io::{self, ErrorKind};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::thread::Builder;

use cms_proto::{GateConfig, Method};

pub use registry::{DuplicateMethod, Registry};

/// A listening host: the socket, and the table every connection is served from.
///
/// The registry is shared rather than copied, so every connection answers from
/// one table and a service cannot be running under two versions of it.
pub struct Host {
    listener: TcpListener,
    registry: Arc<Registry>,
}

impl Host {
    /// Binds the address and takes the methods this host answers for.
    ///
    /// # Errors
    ///
    /// [`HostError::Duplicate`] when two methods share a name, and
    /// [`HostError::Bind`] when the address cannot be listened on. Port zero
    /// asks the kernel for one, which [`Self::local_addr`] then reports.
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

    /// The address the listener actually holds, which is how a caller learns the
    /// port it asked the kernel for.
    ///
    /// # Errors
    ///
    /// [`HostError::Address`] when the socket no longer has a local address.
    pub fn local_addr(&self) -> Result<SocketAddr, HostError> {
        self.listener.local_addr().map_err(HostError::Address)
    }

    /// Accepts connections for as long as the listener holds, one thread each.
    ///
    /// A connection that breaks is that thread's whole business and ends there;
    /// the listener itself failing is returned, because a host that can no
    /// longer accept is a failure its caller has to act on rather than retry.
    ///
    /// # Errors
    ///
    /// [`HostError::Accept`] when the listener stops accepting, and
    /// [`HostError::Spawn`] when a connection thread cannot be started.
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
