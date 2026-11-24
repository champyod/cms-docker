//! The outbound client driven over real sockets and scripted listeners.

mod host;
mod protocol;
mod scripted;

use std::error::Error;
use std::net::SocketAddr;
use std::thread::{self, JoinHandle};

use cms_proto::GateConfig;
use cms_svc::{Client, ClientError, Host, HostError, RunOutcome, Stop};
use serde_json::json;

/// The secret the authenticated host tests configure.
pub(crate) const SECRET: &str = "correct horse battery";

/// A host whose accept thread is always stopped and joined.
pub(crate) struct TestHost {
    addr: SocketAddr,
    stop: Stop,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl TestHost {
    /// Starts the common service methods on an ephemeral loopback port.
    pub(crate) fn start(secret: Option<&str>) -> Self {
        let config = GateConfig {
            secret,
            is_backdoor_enabled: false,
        };
        let host = Host::bind("127.0.0.1:0", cms_svc::service::methods(), (), config)
            .expect("an ephemeral port is bindable");
        let addr = host
            .local_addr()
            .expect("a bound listener reports its address");
        let stop = host.stop_handle();
        let thread = Some(thread::spawn(move || host.run()));
        Self { addr, stop, thread }
    }

    /// The address the kernel selected for this host.
    pub(crate) const fn addr(&self) -> SocketAddr {
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

/// Checks every rendering of an error, including its source chain, for secret leakage.
pub(crate) fn assert_no_secret(error: &ClientError, secret: &str) {
    assert!(
        !format!("{error:?}").contains(secret),
        "the debug error leaked the configured secret"
    );
    assert!(
        !error.to_string().contains(secret),
        "the displayed error leaked the configured secret"
    );
    let mut source = error.source();
    while let Some(error) = source {
        assert!(
            !format!("{error:?}").contains(secret),
            "the debug source leaked the configured secret"
        );
        assert!(
            !error.to_string().contains(secret),
            "the displayed source leaked the configured secret"
        );
        source = error.source();
    }
}

#[test]
fn echo_round_trips_against_a_real_host() {
    let host = TestHost::start(Some(SECRET));
    let mut client = Client::connect(host.addr(), Some(SECRET.to_owned()))
        .expect("the client reaches the listening host");

    assert_eq!(
        client
            .echo("sawasdee")
            .expect("the host echoes the string unchanged"),
        json!("sawasdee")
    );
}
