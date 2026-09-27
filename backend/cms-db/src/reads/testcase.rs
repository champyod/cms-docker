//! One dataset's `testcases` rows: the columns that read them, and the record
//! each maps onto.

use sqlx::{ColumnIndex, Decode, Error, FromRow, Row, Type};

use super::ReadError;

use crate::digest::FileDigest;

/// The columns every `testcases` row of one dataset is read with, bound to that
/// dataset's id as `$1`.
pub const TESTCASES_BY_DATASET: &str = "\
    SELECT c.id, c.dataset_id, c.codename, c.public AS is_public, c.input, c.output
    FROM testcases AS c
    WHERE c.dataset_id = $1";

/// One `DIGEST` column under both names it is refused by: the alias its query
/// projects it under, which the driver reads and reports a decode failure
/// against, and the table column the domain's own rule is named after.
const INPUT_DIGEST: (&str, &str) = ("input", "testcases.input");
const OUTPUT_DIGEST: (&str, &str) = ("output", "testcases.output");

/// One testcase: the codename an evaluation names it by, and the two digests.
///
/// The mapping is written out rather than derived because a `DIGEST` column has
/// to be parsed against the domain's rule, which a field name cannot express.
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
        input: digest_of(INPUT_DIGEST.1, input)?,
        output: digest_of(OUTPUT_DIGEST.1, output)?,
    })
}

// The driver only decodes a field type, and only resolves a column name, once it
// knows the database behind the row, so every field type is bounded here as the
// derived mappings bound theirs.
impl<'r, R: Row> FromRow<'r, R> for TestcaseRecord
where
    for<'name> &'name str: ColumnIndex<R>,
    i32: Type<R::Database> + Decode<'r, R::Database>,
    String: Type<R::Database> + Decode<'r, R::Database>,
    bool: Type<R::Database> + Decode<'r, R::Database>,
{
    /// # Errors
    ///
    /// Returns the driver's own error for a column it could not read, and
    /// [`ReadError::Digest`] under [`Error::ColumnDecode`] for a `DIGEST` the
    /// domain would have refused.
    fn from_row(row: &'r R) -> Result<Self, Error> {
        Ok(Self {
            id: row.try_get("id")?,
            dataset_id: row.try_get("dataset_id")?,
            codename: row.try_get("codename")?,
            is_public: row.try_get("is_public")?,
            input: digest_from(row, INPUT_DIGEST)?,
            output: digest_from(row, OUTPUT_DIGEST)?,
        })
    }
}

/// Reads one `DIGEST` column of the row under both of its names, so a refusal
/// says which column the driver read and which rule broke it.
fn digest_from<'r, R: Row>(
    row: &'r R,
    digest: (&'static str, &'static str),
) -> Result<FileDigest, Error>
where
    for<'name> &'name str: ColumnIndex<R>,
    String: Type<R::Database> + Decode<'r, R::Database>,
{
    let (field, column) = digest;
    let text: String = row.try_get(field)?;

    digest_of(column, &text).map_err(|source| Error::ColumnDecode {
        index: field.to_string(),
        source: Box::new(source),
    })
}

/// Parses one `DIGEST` column, naming the column when the domain refuses it.
fn digest_of(column: &'static str, text: &str) -> Result<FileDigest, ReadError> {
    text.parse()
        .map_err(|source| ReadError::Digest(column, source))
}
