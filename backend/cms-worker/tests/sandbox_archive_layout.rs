//! What an archive holds of the run directory, and what the run directory is left
//! holding afterwards.
//!
//! No isolation program is involved in any of it: archiving reads the directory and
//! asks the store, and neither runs anything. The archives are read back as gzip
//! streams and unpacked, so a change to the packing is caught in the bytes rather
//! than in a digest that would change along with it.
//!
//! The stage is the run's own directory, which is the layout a run is handed, so
//! the packed copy lands inside the very directory the walk read and is gone from
//! it again before any later walk of that directory could pack it once more.

#[path = "sandbox_archive_helpers.rs"]
mod support;

use std::fs;

use support::{
    at, box_with_output, pack, read, ARCHIVE_NAME, GRADED_OUTPUT, HOME_NAME, NESTED_CONTENT,
    NESTED_NAME, OUTPUT_NAME,
};

#[test]
fn the_archive_holds_the_run_directory_under_its_own_name() {
    let (sandbox, stage, cache) = box_with_output("listing");

    let listed = support::names(&pack(&sandbox, &stage, &cache));
    let wanted = format!("{HOME_NAME}/");

    assert!(
        listed.iter().all(|n| n.starts_with(&wanted)),
        "under {wanted}: {listed:?}"
    );
    assert!(listed.contains(&at(OUTPUT_NAME)), "output: {listed:?}");
    assert!(listed.contains(&at(NESTED_NAME)), "nested file: {listed:?}");
    assert!(
        !listed.contains(&at(ARCHIVE_NAME)),
        "the archive never holds itself: {listed:?}"
    );
}

#[test]
fn what_the_archive_holds_is_what_the_run_left() {
    let (sandbox, stage, cache) = box_with_output("roundtrip");

    let packed = pack(&sandbox, &stage, &cache);

    assert_eq!(read(&packed, &at(OUTPUT_NAME)), GRADED_OUTPUT);
    assert_eq!(read(&packed, &at(NESTED_NAME)), NESTED_CONTENT);
}

#[test]
fn a_link_in_the_run_directory_is_archived_as_a_link_and_not_followed() {
    let (sandbox, stage, cache) = box_with_output("link");
    let inside = sandbox.home().join(OUTPUT_NAME);
    let link = sandbox.home().join("answer.link");
    let _ = fs::remove_file(&link);
    std::os::unix::fs::symlink(&inside, &link).expect("the link must be creatable");

    let packed = pack(&sandbox, &stage, &cache);

    assert!(
        read(&packed, &at("answer.link")).is_empty(),
        "a link holds no bytes"
    );
}

#[test]
fn nothing_is_left_behind_where_the_next_archive_would_pack_it_again() {
    let (sandbox, stage, _cache) = box_with_output("clean");

    let digest = sandbox.archive(&stage).expect("the directory is there");

    assert_eq!(
        stage.path(ARCHIVE_NAME),
        sandbox.home().join(ARCHIVE_NAME),
        "the stage is the run's own directory, so a copy kept there is packed again"
    );
    assert!(
        !sandbox.home().join(ARCHIVE_NAME).exists(),
        "the directory the archive was packed out of keeps no copy"
    );
    assert_eq!(digest.as_str().len(), 40, "a digest is forty characters");
}
