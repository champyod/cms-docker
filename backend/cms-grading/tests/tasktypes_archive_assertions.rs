use std::path::PathBuf;
use std::str::FromStr;

use cms_grading::stage::{Cache, CacheHandle, FileDigest, FsCache};
use cms_proto::DigestMap;
use serde_json::{json, Map, Value};

pub fn assert_archived(store: &FsCache, sandboxes: &[PathBuf], digests: &DigestMap) {
    assert_eq!(sandboxes.len(), digests.len());
    for path in sandboxes {
        let key = path.to_string_lossy().into_owned();
        let digest = digests.get(&key).expect("the sandbox path has a digest");
        let digest = FileDigest::from_str(digest).expect("a digest the domain admits");
        let packed = store
            .get_file(&CacheHandle::new(digest))
            .expect("the archive is filed in the store");
        assert!(packed.starts_with(&[0x1f, 0x8b]));
    }
}

pub fn assert_body_pair(body: &Map<String, Value>, sandboxes: &[PathBuf], digests: &DigestMap) {
    assert_eq!(body["sandbox_digests"], json!(digests));
    assert_eq!(body["sandboxes"], json!(sandboxes));
}
