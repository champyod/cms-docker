//! The logs a stub writes, the stub itself, and the run's own directory.
//!
//! Nothing here needs an isolation program to be installed. A run is launched
//! under a stub executable the test wrote, which writes the log a real one would
//! write, prints as much to both pipes as a pipe cannot hold, and returns a code
//! the test chose. That makes the drain, the log, the codes and the limits all
//! decided by the test rather than by a machine.

// Every suite draws a different part of this file, and the file is a test target
// of its own, so no single compilation uses all of it.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use cms_worker::sandbox::Sandbox;

/// The kibibytes the log's memory figure is reported in.
pub const KIB: u64 = 1024;
/// The log a stub writes for a run that returned non-zero and was charged 0.5s.
pub const RETURNED_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\nstatus:RE\nexitcode:3\n";
/// A log with no number in it, for a key that promises one.
pub const UNREADABLE_LOG: &str = "time:not-a-number\n";

/// A directory of this test's own, named after the test so parallel tests differ.
///
/// The stubs are written into the build directory rather than the system's
/// temporary one: a run is started by forking, and forking in a process whose
/// other threads are still writing executables into a memory-backed temporary
/// directory can be refused as a file that is still open for writing.
pub fn workspace(test: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(test);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("the test's own directory must be creatable");
    dir
}

/// Writes an executable stub, and the path to run it by.
///
/// The file is created new and written to its end before it is run: a stub that
/// is still being written when the run starts it cannot be executed at all, and
/// the refusal names the file rather than anything the run did.
pub fn stub(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .expect("the stub must be creatable");
    file.write_all(body.as_bytes())
        .expect("the stub must be writable");
    file.sync_all()
        .expect("the stub must be written to its end");
    drop(file);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("the stub must run");
    path
}

/// A stub standing in for the isolation program: it writes the log it was told to
/// write, prints far more to both pipes than either of them can hold, and returns
/// the code it was told to return.
pub fn isolation_stub(dir: &Path, code: &str, log: &str) -> PathBuf {
    stub(
        dir,
        "isolate",
        &format!(
            "#!/bin/sh\n\
             meta=\n\
             for arg in \"$@\"; do\n\
             \x20 case \"$arg\" in --meta=*) meta=\"${{arg#--meta=}}\" ;; esac\n\
             done\n\
             line=0123456789012345678901234567890123456789012345678901234567890123\n\
             i=0\n\
             while [ \"$i\" -lt 2000 ]; do\n\
             \x20 printf '%s\\n' \"$line\"\n\
             \x20 printf '%s\\n' \"$line\" >&2\n\
             \x20 i=$((i + 1))\n\
             done\n\
             printf '{log}' > \"$meta\"\n\
             exit {code}\n"
        ),
    )
}

/// A stub standing in for the isolation program that also writes down the words it
/// was launched with, one per line, into `record`.
///
/// This is the only way the words a run is actually started with can be read back
/// on this side, and it is what a change to how those words are built is compared
/// against.
pub fn isolation_stub_recording(dir: &Path, code: &str, log: &str, record: &Path) -> PathBuf {
    let record = record.display();
    stub(
        dir,
        "isolate",
        &format!(
            "#!/bin/sh\n\
             meta=\n\
             : > '{record}'\n\
             for arg in \"$@\"; do\n\
             \x20 printf '%s\\n' \"$arg\" >> '{record}'\n\
             \x20 case \"$arg\" in --meta=*) meta=\"${{arg#--meta=}}\" ;; esac\n\
             done\n\
             printf '{log}' > \"$meta\"\n\
             exit {code}\n"
        ),
    )
}

/// A sandbox whose runs are launched under the stub at `executable`.
pub fn sandbox(executable: &Path, dir: &Path) -> Sandbox {
    Sandbox::new(executable, dir, "box").expect("the run's own directory must be creatable")
}

/// The status a process that returned `code` would have.
pub fn exit_status_of(code: i32) -> std::process::ExitStatus {
    std::process::Command::new("/bin/sh")
        .args(["-c", &format!("exit {code}")])
        .status()
        .expect("the shell must run")
}
