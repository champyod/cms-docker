//! Blanking the two halves of a user-test result.
//!
//! `UserTestResult.invalidate_compilation` and `invalidate_evaluation`
//! (`src/cms/db/usertest.py:454-481`) are what a re-judge calls before the row is
//! written again. Invalidating a compilation invalidates the evaluation under it
//! too, because an executable the new compilation does not produce cannot keep an
//! old verdict.

use super::result::UserTestResult;

impl UserTestResult {
    /// Blank every compilation and evaluation outcome, and the executables.
    ///
    /// The reference also assigned `compilation_sandbox`, an attribute the model
    /// does not declare; the paths and digests behind that name are what exist to
    /// clear, so they are cleared here.
    pub fn invalidate_compilation(&mut self) {
        self.invalidate_evaluation();
        self.compilation_outcome = None;
        self.compilation_text.clear();
        self.compilation_tries = 0;
        self.compilation_stdout = None;
        self.compilation_stderr = None;
        self.compilation_time = None;
        self.compilation_wall_clock_time = None;
        self.compilation_memory = None;
        self.compilation_shard = None;
        self.compilation_sandbox_paths = None;
        self.compilation_sandbox_digests = None;
        self.executables_clear();
    }

    /// Blank the evaluation and the output, leaving the compilation intact.
    pub fn invalidate_evaluation(&mut self) {
        self.evaluation_outcome = None;
        self.evaluation_text.clear();
        self.evaluation_tries = 0;
        self.execution_time = None;
        self.execution_wall_clock_time = None;
        self.execution_memory = None;
        self.evaluation_shard = None;
        self.evaluation_sandbox_paths = None;
        self.evaluation_sandbox_digests = None;
        self.output = None;
    }
}
