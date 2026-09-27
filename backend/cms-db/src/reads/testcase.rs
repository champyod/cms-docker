//! One dataset's `testcases` rows: the columns that read them, and the record
//! each maps onto.

use super::ReadError;

use crate::digest::FileDigest;

/// The columns every `testcases` row of one dataset is read with, bound to that
/// dataset's id as `$1`.
pub const TESTCASES_BY_DATASET: &str = "\
    SELECT c.id, c.dataset_id, c.codename, c.public AS is_public, c.input, c.output
    FROM testcases AS c
    WHERE c.dataset_id = $1";

/// One testcase: the codename an evaluation names it by, and the two digests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestcaseRecord {
    /// The one testcase of the set an evaluation measured, and what
    /// `invalidate_evaluation` matches on to drop that one and leave the rest.
    pub id: i32,
    /// `testcases.dataset_id`, the dataset the testcase belongs to.
    pub dataset_id: i32,
    /// `testcases.codename`, unique within its dataset.
    pub codename: String,
    /// `testcases.public`, whether the outcome is shown without a token.
    pub is_public: bool,
    /// `testcases.input`, the digest of the input file.
    pub input: FileDigest,
    /// `testcases.output`, the digest of the output file.
    pub output: FileDigest,
}

/// Maps the columns [`TESTCASES_BY_DATASET`] names onto the record.
///
/// # Errors
///
/// Returns [`ReadError::Digest`] naming the column when `input` or `output` holds
/// a value the `DIGEST` domain would have refused, rather than carrying a digest
/// no caller may hand to the file cache.
pub fn testcase_from_row(
    id: i32,
    dataset_id: i32,
    codename: String,
    is_public: bool,
    input: &str,
    output: &str,
) -> Result<TestcaseRecord, ReadError> {
    Ok(TestcaseRecord {
        id,
        dataset_id,
        codename,
        is_public,
        input: digest_of("testcases.input", input)?,
        output: digest_of("testcases.output", output)?,
    })
}

/// Parses one `DIGEST` column, naming the column when the domain refuses it.
fn digest_of(column: &'static str, text: &str) -> Result<FileDigest, ReadError> {
    text.parse()
        .map_err(|source| ReadError::Digest(column, source))
}
