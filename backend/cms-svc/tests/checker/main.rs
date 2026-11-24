//! The Checker over real sockets: live peers, refused dials, and malformed answers.

mod host;
mod scripted;

use std::net::SocketAddr;

use cms_proto::Method;
use cms_svc::checker::{Checker, CheckerError};
use cms_svc::{ClientError, ServiceCoord};
use serde_json::{json, Value};

/// The secret shared by the checker and the hosts under test.
const SECRET: &str = "checker test secret";

/// A table row whose host and port are the address the kernel actually bound.
fn table(addr: SocketAddr, name: &str) -> String {
    format!("{name}|0|{}|{}\n", addr.ip(), addr.port())
}

/// A checker configured for the authenticated hosts under test.
fn checker(table: &str) -> Checker {
    Checker::new(table)
        .expect("the table names a readable peer")
        .with_secret(Some(SECRET.to_owned()))
}

#[test]
fn one_live_peer_is_checked_once() {
    let host = host::TestHost::start();
    let mut checker = checker(&table(host.addr(), "Peer"));

    let report = checker.check_once(1_700_000_000.125);

    assert_eq!(report.checked, 1);
    assert_eq!(report.failed, 0);
    assert_eq!(report.late, 0);
    assert_eq!(report.peers[0].coord, ServiceCoord::new("Peer", 0));
    assert!(report.peers[0]
        .latency
        .is_some_and(|latency| latency >= 0.0));
    assert!(report.peers[0].error.is_none());
}

#[test]
fn a_live_client_is_reused_by_the_next_round() {
    let (addr, requests) = scripted::serve_twice(|request| {
        let answer = request.data["string"]
            .as_str()
            .expect("echo carries a string");
        scripted::reply(request, json!(answer))
    });
    let mut checker = checker(&table(addr, "Peer"));

    assert_eq!(checker.check_once(10.0).failed, 0);
    assert_eq!(checker.check_once(11.0).failed, 0);

    let requests = requests.join().expect("the scripted peer finishes");
    assert_eq!(requests.len(), 2);
    assert!(requests
        .iter()
        .all(|request| request.secret.as_deref() == Some(SECRET)));
    assert_eq!(scripted::echoed(&requests[0]), "Peer,0 10.000");
    assert_eq!(scripted::echoed(&requests[1]), "Peer,0 11.000");
}

#[test]
fn a_dead_port_is_one_failed_check_not_a_panic() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port can be reserved");
    let addr = listener
        .local_addr()
        .expect("the reserved port has an address");
    drop(listener);
    let mut checker = checker(&table(addr, "Peer"));

    let report = checker.check_once(10.0);

    assert_eq!(report.checked, 1);
    assert_eq!(report.failed, 1);
    assert_eq!(report.late, 0);
    assert!(matches!(
        report.peers[0].error,
        Some(CheckerError::Rpc {
            source: ClientError::Connect(_),
            ..
        })
    ));
}

#[test]
fn one_failed_dial_does_not_end_the_round() {
    let host = host::TestHost::start();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port can be reserved");
    let dead = listener
        .local_addr()
        .expect("the reserved port has an address");
    drop(listener);
    let table = format!("{}{}", table(dead, "Dead"), table(host.addr(), "Live"));
    let mut checker = checker(&table);

    let report = checker.check_once(10.0);

    assert_eq!(report.checked, 2);
    assert_eq!(report.failed, 1);
    assert_eq!(report.peers[0].coord, ServiceCoord::new("Dead", 0));
    assert!(report.peers[0].error.is_some());
    assert_eq!(report.peers[1].coord, ServiceCoord::new("Live", 0));
    assert!(report.peers[1].error.is_none());
}

#[test]
fn a_reply_older_than_ten_seconds_is_late_without_sleeping() {
    let methods = vec![Method {
        name: "echo",
        is_callable: true,
        handler: old_echo,
    }];
    let host = host::TestHost::with_methods(methods);
    let mut checker = checker(&table(host.addr(), "Peer"));

    let report = checker.check_once(11.0);

    assert_eq!(report.checked, 1);
    assert_eq!(report.failed, 0);
    assert_eq!(report.late, 1);
    assert!(report.peers[0]
        .latency
        .is_some_and(|latency| latency < 11.0));
    assert!(report.peers[0].late);
}

#[test]
fn a_non_string_rpc_error_is_one_failed_check_not_a_panic() {
    let (addr, request) = scripted::serve_once(|request| {
        scripted::reply_with_error(request, scripted::structured_error())
    });
    let mut checker = checker(&table(addr, "Peer"));

    let report = checker.check_once(10.0);

    assert_eq!(report.checked, 1);
    assert_eq!(report.failed, 1);
    assert_eq!(report.late, 0);
    assert!(matches!(
        report.peers[0].error,
        Some(CheckerError::Rpc {
            source: ClientError::Refused(_),
            ..
        })
    ));
    assert_eq!(request.join().expect("the scripted peer finishes").len(), 1);
}

#[test]
fn a_malformed_echo_string_is_one_failed_check_not_a_panic() {
    let (addr, request) = scripted::serve_once(|request| scripted::reply(request, json!("broken")));
    let mut checker = checker(&table(addr, "Peer"));

    let report = checker.check_once(10.0);

    assert_eq!(report.checked, 1);
    assert_eq!(report.failed, 1);
    assert!(matches!(
        report.peers[0].error,
        Some(CheckerError::InvalidReply { .. })
    ));
    assert_eq!(request.join().expect("the scripted peer finishes").len(), 1);
}

#[test]
fn a_malformed_table_refuses_the_checker_before_any_dial() {
    let error = match Checker::new("Peer|zero|127.0.0.1|22000\n") {
        Ok(_) => panic!("bad shard must refuse the checker"),
        Err(error) => error,
    };
    assert!(matches!(error, CheckerError::Table(_)));
}

/// An echo method whose answer claims to have been sent at the epoch.
fn old_echo(_data: &Value, _context: &()) -> Result<Value, String> {
    Ok(json!("Peer,0 0.000"))
}
