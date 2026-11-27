//! The user-test half of the database: the five tables, their name domains, and
//! the result status the evaluator reads.
//!
//! `src/cms/db/usertest.py` holds `UserTest`, the two named file tables, the
//! result keyed by test and dataset, and the executables under that result. The
//! referential rules — the two `(user_test_id, filename)` uniques, the unique
//! result key, and the composite foreign key from an executable to its result —
//! are enforced in `files` and `results`; the columns and their domains are here.

mod files;
mod inputs;
mod invalidate;
mod model;
mod name;
mod referential;
mod result;
mod result_read;
mod results;
mod schema;

pub use files::{UserTestFiles, UserTestManagers};
pub use inputs::{user_test_inputs, UserTestInputs, UserTestInputsError};
pub use model::{UserTest, UserTestExecutable, UserTestFile, UserTestManager};
pub use name::{Filename, FilenameError, FilenameSchema};
pub use referential::ReferentialError;
pub use result::{ResultKey, UserTestResult, UserTestStatus};
pub use result_read::{user_test_result, UserTestResultReadError, USER_TEST_RESULT_BY_ID};
pub use results::UserTestResults;
pub use schema::{
    USER_TEST, USER_TEST_EXECUTABLE, USER_TEST_FILE, USER_TEST_MANAGER, USER_TEST_RESULT,
};
