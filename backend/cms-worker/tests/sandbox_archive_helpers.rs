//! The directory a run leaves, the store an archive is filed in, and the reading
//! back of what was filed.
//!
//! No isolation program is involved in any of it: archiving reads the directory and
//! asks the store, and neither runs anything. The packed bytes are read back through
//! the store rather than off the disk, so what a test claims is what a run's archive
//! is actually filed as.
//!
//! Both archive suites compile this file and each of them uses only part of it.

#![allow(dead_code, unused_imports)]

#[path = "sandbox_helpers.rs"]
mod base;

use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use cms_worker::sandbox::Sandbox;
use cms_worker::stage::{Cache, CacheHandle, FileDigest, FsCache, Stage};

use flate2::read::GzDecoder;

use base::stub;

pub use base::workspace;

/// What a run leaves in its own directory, at the top and one level down.
pub const GRADED_OUTPUT: &[u8] = b"one graded answer\n";
pub const OUTPUT_NAME: &str = "grader.out";
pub const NESTED_NAME: &str = "sub/table.txt";
pub const NESTED_CONTENT: &[u8] = b"nested table\n";

/// A file of one byte repeated, which is what a compressor is measured against.
pub const REPETITIVE_NAME: &str = "repetitive.bin";
pub const REPETITIVE_LEN: usize = 64 * 1024;

/// The two bytes every gzip stream begins with: the magic number, then the method.
pub const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// The name the run's own directory is archived under, which is its own name.
pub const HOME_NAME: &str = "home";

/// The name the packed copy is written under inside the stage.
pub const ARCHIVE_NAME: &str = "sandbox-archive.tar.gz";

/// What one of these directories holds at a path inside the archive.
pub fn at(name: &str) -> String {
    format!("{HOME_NAME}/{name}")
}

/// A sandbox holding what a run would have left, and the store to file it in.
///
/// The stage is the run's own directory, which is the layout a run is handed,
/// so the packed copy is written into the directory the walk read.
pub fn box_with_output(test: &str) -> (Sandbox, Stage, PathBuf) {
    let dir = workspace(test);
    let executable = stub(&dir, "isolate", "#!/bin/sh\nexit 0\n");
    let sandbox = Sandbox::new(&executable, &dir, "box").expect("box uncreatable");
    let home = sandbox.home();
    fs::write(home.join(OUTPUT_NAME), GRADED_OUTPUT).expect("output unwritable");
    fs::create_dir(home.join("sub")).expect("subdir uncreatable");
    fs::write(home.join(NESTED_NAME), NESTED_CONTENT).expect("nested unwritable");
    let cache = dir.join("cache");
    let store = FsCache::at(&cache).expect("store uncreatable");
    let stage = Stage::at(home, Box::new(store)).expect("stage uncreatable");
    (sandbox, stage, cache)
}

/// The archive a sandbox packed and the store took, read back through the store.
pub fn pack(sandbox: &Sandbox, stage: &Stage, cache: &Path) -> Vec<u8> {
    let digest = sandbox.archive(stage).expect("the directory is there");
    filed(cache, &digest)
}

/// The bytes the store answers with for a digest, read back through the store
/// rather than off the disk, so the archive is proved to have been filed.
pub fn filed(cache: &Path, digest: &FileDigest) -> Vec<u8> {
    let store = FsCache::at(cache).expect("store unreadable");
    let handle = CacheHandle::new(digest.clone());
    store.get_file(&handle).expect("the store must answer")
}

/// How many files the store holds, which is what an unfilled store is.
pub fn held(cache: &Path) -> usize {
    fs::read_dir(cache).expect("store unreadable").count()
}

/// Whether a text is forty lowercase hexadecimal digits, which is a digest.
pub fn lowercase_hex(text: &str) -> bool {
    let digits = text
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
    text.len() == 40 && digits
}

/// Every path a packed archive lists, in the order the archive holds them.
pub fn names(packed: &[u8]) -> Vec<String> {
    let mut archive = tar::Archive::new(GzDecoder::new(packed));
    let listed = archive.entries().expect("unreadable archive");
    listed
        .map(|entry| named(&entry.expect("unreadable entry")))
        .collect()
}

/// The path one entry is archived under.
pub fn named(entry: &tar::Entry<GzDecoder<&[u8]>>) -> String {
    entry
        .path()
        .expect("an entry names a path")
        .to_string_lossy()
        .into_owned()
}

/// What the archive holds at one path, unpacked from the packed bytes.
pub fn read(packed: &[u8], wanted: &str) -> Vec<u8> {
    let mut archive = tar::Archive::new(GzDecoder::new(packed));
    for entry in archive.entries().expect("unreadable archive") {
        let mut entry = entry.expect("unreadable entry");
        if named(&entry) != wanted {
            continue;
        }
        let mut content = Vec::new();
        entry.read_to_end(&mut content).expect("unreadable entry");
        return content;
    }
    panic!("the archive must hold {wanted}")
}
