//! A real RPC host whose accept thread is always stopped and joined.

use std::net::SocketAddr;
use std::thread::{self, JoinHandle};

use cms_proto::{GateConfig, Method};
use cms_svc::{Host, HostError, RunOutcome, Stop};

use crate::SECRET;

/// A host under test, stopped when the guard leaves scope.
pub(super) struct TestHost {
    addr: SocketAddr,
    stop: Stop,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl TestHost {
    /// Starts the base service methods on an ephemeral loopback port.
    pub(super) fn start() -> Self {
        Self::with_methods(cms_svc::service::methods())
    }

    /// Starts the supplied methods on an ephemeral loopback port.
    pub(super) fn with_methods(methods: Vec<Method<()>>) -> Self {
        let config = GateConfig {
            secret: Some(SECRET),
            is_backdoor_enabled: false,
        };
        let host =
            Host::bind("127.0.0.1:0", methods, (), config).expect("an ephemeral port is bindable");
        let addr = host
            .local_addr()
            .expect("a bound listener reports its address");
        let stop = host.stop_handle();
        let thread = Some(thread::spawn(move || host.run()));
        Self { addr, stop, thread }
    }

    /// The address the kernel selected for this host.
    pub(super) const fn addr(&self) -> SocketAddr {
        self.addr
    }
}

impl Drop for TestHost {
    fn drop(&mut self) {
        self.stop.request();
        self.thread
            .take()
            .expect("a host thread is joined once")
            .join()
            .expect("the host thread does not panic")
            .expect("the host stops normally");
    }
}
