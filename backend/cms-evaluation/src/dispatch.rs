//! Synchronous dispatch of one job group to the worker that owns each shard.
//!
//! [`WorkerDispatcher`] keeps one lazily-opened [`Client`] per shard address.
//! A call sends a single `execute_job_group` request, parses the reply as a
//! [`JobGroup`], and refuses a group whose job count differs from the one it
//! sent. Reconnection and retry belong to the caller: a failed call drops that
//! shard's client so the next dispatch dials again, but nothing here retries.

use std::fmt;
use std::net::SocketAddr;

use cms_proto::JobGroup;
use cms_svc::{Client, ClientError};
use serde_json::{json, Value};

/// The worker method that runs one group of jobs.
const EXECUTE_METHOD: &str = "execute_job_group";

/// The argument key that carries the jobs array.
const JOBS_ARGUMENT: &str = "jobs";

/// Sends job groups to per-shard workers over persistent, synchronous clients.
pub struct WorkerDispatcher {
    addresses: Vec<SocketAddr>,
    secret: Option<String>,
    clients: Vec<Option<Client>>,
}

impl WorkerDispatcher {
    /// Creates a dispatcher with one unconnected client slot per address.
    ///
    /// Every shard shares the same `secret`; a connection is opened only the
    /// first time that shard is dispatched to.
    #[must_use]
    pub fn new(addresses: Vec<SocketAddr>, secret: Option<String>) -> Self {
        let clients: Vec<Option<Client>> = addresses.iter().map(|_| None).collect();
        Self {
            addresses,
            secret,
            clients,
        }
    }

    /// Dispatches `jobs` to `shard` and validates the returned [`JobGroup`].
    ///
    /// # Errors
    ///
    /// [`DispatchError::NoWorker`] when `shard` has no address,
    /// [`DispatchError::Client`] when the connection or call fails (that
    /// shard's client is dropped, so the next call reconnects),
    /// [`DispatchError::Response`] when the reply is not a `JobGroup`, and
    /// [`DispatchError::CountMismatch`] when the returned job count differs.
    pub fn dispatch(&mut self, shard: usize, jobs: Vec<Value>) -> Result<JobGroup, DispatchError> {
        let address = *self
            .addresses
            .get(shard)
            .ok_or(DispatchError::NoWorker { shard })?;
        let sent = jobs.len();
        let reply = match self.call(shard, address, jobs) {
            Ok(reply) => reply,
            Err(error) => {
                self.clients[shard] = None;
                return Err(DispatchError::Client(error));
            }
        };
        let group: JobGroup = serde_json::from_value(reply).map_err(DispatchError::Response)?;
        let received = group.jobs.len();
        if received != sent {
            return Err(DispatchError::CountMismatch { sent, received });
        }
        Ok(group)
    }

    /// Connects lazily, then sends one `execute_job_group` call.
    fn call(
        &mut self,
        shard: usize,
        address: SocketAddr,
        jobs: Vec<Value>,
    ) -> Result<Value, ClientError> {
        if self.clients[shard].is_none() {
            let client = Client::connect(address, self.secret.clone())?;
            self.clients[shard] = Some(client);
        }
        let client = self.clients[shard]
            .as_mut()
            .expect("the client was connected above");
        client.call(EXECUTE_METHOD, json!({ JOBS_ARGUMENT: jobs }))
    }
}

/// Why a dispatch did not yield a validated [`JobGroup`].
///
/// The four cases stay distinct so a caller can tell a bad shard, a broken
/// connection, a malformed reply and a wrong-sized batch apart. No variant
/// carries the shared secret.
#[derive(Debug)]
pub enum DispatchError {
    /// `shard` has no worker address configured.
    NoWorker {
        /// The shard index that was out of range.
        shard: usize,
    },
    /// The connection or the call failed.
    Client(ClientError),
    /// The reply could not be parsed as a [`JobGroup`].
    Response(serde_json::Error),
    /// The worker returned a different number of jobs than were sent.
    CountMismatch {
        /// Number of jobs sent in the request.
        sent: usize,
        /// Number of jobs present in the reply.
        received: usize,
    },
}

impl fmt::Display for DispatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoWorker { shard } => write!(formatter, "no worker for shard {shard}"),
            Self::Client(error) => write!(formatter, "worker call failed: {error}"),
            Self::Response(error) => {
                write!(formatter, "cannot decode the worker's job group: {error}")
            }
            Self::CountMismatch { sent, received } => {
                write!(formatter, "worker returned {received} jobs for {sent} sent")
            }
        }
    }
}

impl std::error::Error for DispatchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Client(error) => Some(error),
            Self::Response(error) => Some(error),
            Self::NoWorker { .. } | Self::CountMismatch { .. } => None,
        }
    }
}
