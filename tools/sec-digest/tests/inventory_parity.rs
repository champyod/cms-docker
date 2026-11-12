//! Inventory parsing against a throwaway checkout tree: the same files the hub has.

use std::fs;
use std::path::{Path, PathBuf};

use sec_digest::inventory::{key_for, load, products_in_text};

fn write(root: &Path, path: &str, body: &str) {
    let full = root.join(path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("fixture dir");
    }
    fs::write(full, body).expect("fixture file");
}

fn write_manifests(root: &Path) {
    write(
        root,
        "cms-docker-major/src/Dockerfile",
        "FROM alpine:3.20\nRUN apk add --no-cache curl\n",
    );
    write(
        root,
        "cms-docker-major/admin-panel/package.json",
        r#"{"dependencies":{"next":"^14.2.3"},"devDependencies":{"typescript":"5.4.5"}}"#,
    );
    write(
        root,
        "cms-docker-major/ranking-web/Cargo.lock",
        "version = 4\n\n[[package]]\nname = \"serde\"\nversion = \"1.0.200\"\n\
         \n[[package]]\nname = \"redis\"\nversion = \"0.27.6\"\n",
    );
    write(root, "cms-docker-major/src/constraints.txt", "requests==2.31.0\n# note\n");
    write(
        root,
        "cms-learn/package.json",
        r#"{"devDependencies":{"ajv":"^8.17.1"}}"#,
    );
    write(
        root,
        "cms-learn/docs/dependencies.md",
        "# Dependencies\n\n## Images\n\n| Image | Version | Licence |\n|---|---|---|\n\
         | drogon | **1.9.14** | MIT |\n\n## TypeScript\n\n| Package | Version |\n|---|---|\n\
         | bun | 1.3.14 |\n",
    );
}

fn fixture_tree(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("cms-docker-major")).expect("docker checkout");
    fs::create_dir_all(root.join("cms-learn")).expect("learn checkout");
    write(
        &root,
        "cms-docker-major/docker-compose.yml",
        "services:\n  web:\n    image: nginx:1.27-alpine@sha256:deadbeef\n\
         \n  cache:\n    image: redis:7-alpine\n\n  db:\n    image: postgres:15\n\
         \n  ours:\n    image: ghcr.io/champyod/cms-docker-core:${IMG_TAG:-main}\n",
    );
    write_manifests(&root);
    root
}

#[test]
fn reads_every_manifest_the_way_the_python_tool_did() {
    let inv = load(&fixture_tree("inventory_full"));
    assert_eq!(inv.images["nginx"].versions, vec!["1.27".to_string()]);
    assert_eq!(inv.images["redis"].versions, vec!["7".to_string()]);
    assert_eq!(inv.images["alpine"].versions, vec!["3.20".to_string()]);
    assert!(!inv.images.contains_key("cms-docker-core"));
    assert_eq!(inv.npm["next"].versions, vec!["14.2.3".to_string()]);
    assert_eq!(inv.npm["ajv"].versions, vec!["8.17.1".to_string()]);
    assert_eq!(inv.cargo["serde"].versions, vec!["1.0.200".to_string()]);
    assert_eq!(inv.pip["requests"].versions, vec!["2.31.0".to_string()]);
    assert_eq!(inv.images["drogon"].versions, vec!["1.9.14".to_string()]);
    assert_eq!(inv.docs["bun"].versions, vec!["1.3.14".to_string()]);
}

#[test]
fn versions_stay_in_their_own_bucket_and_products_union_them() {
    let inv = load(&fixture_tree("inventory_buckets"));
    // A `redis` crate is not the `redis` server: same key, different bucket.
    assert_eq!(inv.cargo["redis"].versions, vec!["0.27.6".to_string()]);
    let redis = &inv.products["redis"];
    assert_eq!(redis.deploy_versions, vec!["7".to_string()]);
    assert_eq!(redis.lib_versions, vec!["0.27.6".to_string()]);
    assert_eq!(redis.versions, vec!["7".to_string()]);
    // next only ever came from npm, so it is a library version.
    assert_eq!(inv.products["next"].versions, vec!["14.2.3".to_string()]);
    assert!(inv.products.contains_key("postgres"));
    assert!(inv.products.contains_key("linux"));
}

#[test]
fn host_kernels_are_read_so_kernel_advisories_can_match() {
    let inv = load(&fixture_tree("inventory_hosts"));
    assert_eq!(inv.hosts.len(), 2);
    assert_eq!(inv.hosts[0].kernel, "5.15.0-203-generic");
    assert!(inv.products["linux"].versions.contains(&"5.15.0-203".to_string()));
    assert!(inv.products["linux"].versions.contains(&"7.3.0-4".to_string()));
}

#[test]
fn a_missing_checkout_is_reported_not_silently_empty() {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("inventory_missing");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("empty root");
    let inv = load(&root);
    assert_eq!(inv.notes.len(), 2);
    assert!(inv.notes[0].contains("cms-docker-major: checkout not found"));
    // Hosts are the one hand-kept fact, so the only product left is their kernel.
    assert_eq!(
        inv.products.keys().cloned().collect::<Vec<_>>(),
        vec!["linux".to_string()]
    );
    assert_eq!(inv.images.len(), 0);
    assert_eq!(inv.hosts.len(), 2);
}

#[test]
fn product_matching_uses_boundaries() {
    let inv = load(&fixture_tree("inventory_text"));
    assert_eq!(key_for("nginx"), Some("nginx"));
    assert_eq!(key_for("library/nginx"), Some("nginx"));
    assert_eq!(key_for("nginx-ingress"), None);
    assert_eq!(products_in_text("nginx and OpenSSL"), vec!["nginx", "openssl"]);
    assert!(products_in_text("nginxproxy").is_empty());
    assert_eq!(products_in_text("Linux kernel 6.1"), vec!["linux"]);
    assert!(inv.products.contains_key("nginx"));
}
