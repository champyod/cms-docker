//! Both methods over a real socket, with the service writing into a directory the test owns.
//!
//! The file, the `last.log` link and the buffer are asserted from the same run,
//! because a service is installed once per process: a second `LogService` would
//! take the sink over, so the test that wants every output asks for all three
//! here.

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use cms_proto::GateConfig;
use cms_svc::{FormatterSettings, Host, LogService};
use serde_json::{json, Value};

/// The secret every call here presents.
const SECRET: &str = "correct horse battery";

/// How long a client waits before it calls the host unresponsive.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// One record's worth of arguments, with every optional key the buffer reads.
fn warning() -> Value {
    json!({
        "msg": "submission queue is long",
        "levelname": "WARNING",
        "levelno": 30,
        "created": 1_700_000_002.25,
        "msecs": 250.0,
        "service_name": "WorkerService",
        "service_shard": 3,
        "operation": "collect submissions",
        "filename": "worker.py",
        "funcName": "run",
        "threadName": "MainThread",
    })
}

/// A directory of its own, removed when the test ends.
struct Sandbox {
    path: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("cms-logservice-{}", std::process::id()));
        fs::create_dir(&path).expect("a sandbox of its own must not be there yet");
        Self { path }
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// Starts a host on an ephemeral port, serving the service's own method table.
fn serve(service: &LogService) -> SocketAddr {
    let config = GateConfig {
        secret: Some(SECRET),
        is_backdoor_enabled: false,
    };
    let host = Host::bind("127.0.0.1:0", service.methods(), config)
        .expect("an ephemeral port is bindable");
    let addr = host
        .local_addr()
        .expect("a bound listener reports its address");
    thread::spawn(move || {
        host.run()
            .expect("the listener keeps accepting for the life of the test");
    });
    addr
}

/// Connects with a deadline on every read, so a missing answer fails instead of hanging.
fn connect(addr: SocketAddr) -> TcpStream {
    let stream = TcpStream::connect(addr).expect("the host is listening");
    stream
        .set_read_timeout(Some(READ_TIMEOUT))
        .expect("a read deadline can be set on the test socket");
    stream
}

/// Frames one envelope as the Python transport frames it.
fn wire(envelope: &Value) -> Vec<u8> {
    let mut framed = serde_json::to_vec(envelope).expect("an envelope is JSON");
    framed.extend_from_slice(b"\r\n");
    framed
}

/// Writes one framed call.
fn send(stream: &mut TcpStream, bytes: &[u8]) {
    stream
        .write_all(bytes)
        .expect("the host is still reading this connection");
}

/// Reads one framed reply; a connection that ends first fails the test.
fn read_reply(stream: &mut TcpStream) -> Value {
    let mut received = Vec::new();
    while !received.ends_with(b"\r\n") {
        let mut byte = [0_u8; 1];
        match stream.read(&mut byte) {
            Ok(0) => panic!(
                "the connection closed after {} bytes, before a whole reply",
                received.len()
            ),
            Ok(_) => received.push(byte[0]),
            Err(error) => panic!("no reply arrived: {error}"),
        }
    }
    serde_json::from_slice(&received[..received.len() - 2]).expect("the reply is JSON")
}

/// One warning: a null answer, one line in the file, a `last.log` link, and one buffered entry.
#[test]
fn a_warning_is_written_to_the_file_and_returned_by_last_messages() {
    let sandbox = Sandbox::new();
    let service = LogService::new(&sandbox.path, FormatterSettings::UTC)
        .expect("the service starts in a directory the test owns");
    let addr = serve(&service);
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "log-1",
            "__method": "Log",
            "__data": warning(),
            "__secret": SECRET,
        })),
    );
    let reply = read_reply(&mut stream);
    assert_eq!(reply["__id"], json!("log-1"));
    assert_eq!(reply["__data"], Value::Null);
    assert_eq!(reply["__error"], Value::Null);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "log-2",
            "__method": "last_messages",
            "__data": {},
            "__secret": SECRET,
        })),
    );
    let remembered = read_reply(&mut stream);
    assert_eq!(
        remembered["__data"],
        json!([{
            "message": "submission queue is long",
            "coord": "WorkerService,3",
            "operation": "collect submissions",
            "severity": "WARNING",
            "timestamp": 1_700_000_002.25,
            "exc_text": null,
        }])
    );
    assert_eq!(remembered["__error"], Value::Null);

    assert_eq!(
        fs::read_to_string(service.log_path()).expect("the log file is readable"),
        "2023-11-14 22:13:22,250 - WARNING [Worker,3 Main worker::run] [collect submissions] \
         submission queue is long\n"
    );

    let directory = sandbox.path.join("cms");
    let name = service
        .log_path()
        .file_name()
        .expect("the log file has a name")
        .to_owned();
    assert_eq!(
        fs::read_link(directory.join("last.log")).expect("last.log is a link"),
        PathBuf::from(&name)
    );
    assert!(
        name.to_string_lossy()
            .trim_end_matches(".log")
            .parse::<u64>()
            .is_ok(),
        "the file is named after the epoch second it was opened in"
    );
}
