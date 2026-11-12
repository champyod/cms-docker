//! What this fleet actually runs, read from the repos (never hand-maintained).
//!
//! Versions stay in their own ecosystem bucket (image / npm / cargo / pip / docs):
//! a `redis` crate in ranking-web is not the `redis` server we deploy, and mixing
//! them would produce exactly the false "affects mine" claim this brief exists to
//! avoid. Every version carries the file it was read from.

pub mod keys;
pub mod manifests;
pub mod scan;

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub use keys::{key_for, products_in_text};

use keys::product_name;

/// Default hub root; `--hub` overrides it for tests and for other checkouts.
pub const DEFAULT_HUB: &str = "/mnt/Datas/Champ/Coding/Repos/CMS-Hub";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VersionRecord {
    pub name: String,
    pub versions: Vec<String>,
    #[serde(rename = "where")]
    pub where_paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Product {
    pub key: String,
    pub name: String,
    pub versions: Vec<String>,
    pub deploy_versions: Vec<String>,
    pub lib_versions: Vec<String>,
    #[serde(rename = "where")]
    pub where_paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Host {
    pub name: String,
    pub os: String,
    pub kernel: String,
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Inventory {
    #[serde(default)]
    pub images: BTreeMap<String, VersionRecord>,
    #[serde(default)]
    pub npm: BTreeMap<String, VersionRecord>,
    #[serde(default)]
    pub cargo: BTreeMap<String, VersionRecord>,
    #[serde(default)]
    pub pip: BTreeMap<String, VersionRecord>,
    #[serde(default)]
    pub docs: BTreeMap<String, VersionRecord>,
    #[serde(default)]
    pub products: BTreeMap<String, Product>,
    #[serde(default)]
    pub hosts: Vec<Host>,
    /// Checkouts that were missing: reported with the feed errors, never silent.
    #[serde(skip)]
    pub notes: Vec<String>,
}

impl Inventory {
    pub fn product_keys(&self) -> Vec<String> {
        self.products.keys().cloned().collect()
    }
}

fn hosts() -> Vec<Host> {
    vec![
        Host {
            name: "cms/admin/ranking hosts".to_string(),
            os: "Ubuntu 22.04.5 LTS".to_string(),
            kernel: "5.15.0-203-generic".to_string(),
            note: "jammy GA kernel line; confirmed on como-main 2026-11-10".to_string(),
        },
        Host {
            name: "dev workstation".to_string(),
            os: "CachyOS (Arch)".to_string(),
            kernel: "7.3.0-4-cachyos".to_string(),
            note: "rolling; Arch advisories apply".to_string(),
        },
    ]
}

/// Add the kernel each host runs; no manifest pins it, so without this no kernel
/// advisory could ever match the boxes this brief is about.
fn host_kernels(inv: &mut Inventory) {
    for host in hosts() {
        let version = scan::kernel_version(&host.kernel);
        if let Some(version) = version {
            let where_ = format!("{} ({})", host.name, host.os);
            scan::bucket(&mut inv.docs, "linux", &version, &where_);
        }
        inv.hosts.push(host);
    }
}

fn absorb_record(inv: &mut Inventory, name: &str, record: &VersionRecord, deploy: bool) {
    let Some(key) = key_for(name) else {
        return;
    };
    let product = inv.products.entry(key.to_string()).or_insert_with(|| Product {
        key: key.to_string(),
        name: product_name(key),
        ..Product::default()
    });
    let target = if deploy {
        &mut product.deploy_versions
    } else {
        &mut product.lib_versions
    };
    for version in &record.versions {
        if !target.contains(version) {
            target.push(version.clone());
        }
    }
    for where_ in &record.where_paths {
        if !product.where_paths.contains(where_) {
            product.where_paths.push(where_.clone());
        }
    }
}

/// Union view for product-name matching: every bucket, because an advisory for
/// "next" has to find the npm dependency, not just an image tag.
fn build_products(inv: &mut Inventory) {
    let buckets = [
        (inv.images.clone(), true),
        (inv.docs.clone(), true),
        (inv.npm.clone(), false),
        (inv.cargo.clone(), false),
        (inv.pip.clone(), false),
    ];
    for (records, deploy) in buckets {
        for (name, record) in records {
            absorb_record(inv, &name, &record, deploy);
        }
    }
    for product in inv.products.values_mut() {
        product.versions = if product.deploy_versions.is_empty() {
            product.lib_versions.clone()
        } else {
            product.deploy_versions.clone()
        };
    }
}

pub fn load(root: &Path) -> Inventory {
    let mut inv = Inventory::default();
    let docker = root.join("cms-docker-major");
    let learn = root.join("cms-learn");
    if docker.is_dir() {
        scan::compose_images(&mut inv, &docker);
        scan::dockerfiles(&mut inv, &docker, root);
        manifests::npm(&mut inv, &docker.join("admin-panel"), root);
        manifests::cargo_lock(&mut inv, &docker.join("ranking-web/Cargo.lock"), root);
        manifests::pip_constraints(&mut inv, &docker.join("src/constraints.txt"), root);
    } else {
        inv.notes.push(format!("{}: checkout not found", docker.display()));
    }
    if learn.is_dir() {
        manifests::npm(&mut inv, &learn, root);
        manifests::learn_docs(&mut inv, &learn);
    } else {
        inv.notes.push(format!("{}: checkout not found", learn.display()));
    }
    host_kernels(&mut inv);
    build_products(&mut inv);
    inv
}
