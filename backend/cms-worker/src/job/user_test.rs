//! The two user test paths, side by side: the merge both make and the one thing
//! each of them does differently.
//!
//! A user test is compiled and evaluated by merging the task type's automatic
//! managers over the ones the test carries, so both paths begin the same way and
//! neither is the submission path's path. They part at two points, and both are
//! deliberate: only the compilation adds the dataset's header files, and only the
//! evaluation refuses a language the lookup does not know, because only it needs
//! what the lookup returned. The merge is written out once per path rather than
//! shared, so that the two stay as alike — and as different — as the reference
//! keeps them, and neither can be changed without the other being looked at.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use cms_proto::{DigestMap, Operation, OperationKind};

use super::{check_scope, BuildError, CompilationJob, Dataset, EvaluationJob, Language, UserTest};

/// The placeholder a task type's automatic manager name carries where the
/// language's own source extension goes.
const LANGUAGE_PLACEHOLDER: &str = ".%l";

impl CompilationJob {
    /// Compiles a user test, `CompilationJob.from_user_test`.
    ///
    /// The managers are the merge the two user test paths share, with the
    /// dataset's headers added over it. A language the lookup does not know is
    /// passed over rather than refused: the name is still carried on the job, no
    /// manager is renamed for it, and no header is added, and the compilation
    /// goes on.
    ///
    /// # Errors
    ///
    /// [`BuildError::ObjectMismatch`] and [`BuildError::DatasetMismatch`] when
    /// the operation names another object or dataset,
    /// [`BuildError::UnexpectedOperation`] when it is not a user test
    /// compilation, and [`BuildError::UnknownManager`] when the dataset holds no
    /// manager the task type's automatic list names.
    pub fn from_user_test(
        operation: &Operation,
        user_test: &UserTest,
        dataset: &Dataset,
    ) -> Result<Self, BuildError> {
        check_scope(operation, user_test.id, dataset.id)?;
        if operation.kind != OperationKind::UserTestCompilation {
            return Err(BuildError::UnexpectedOperation {
                wanted: OperationKind::UserTestCompilation,
                found: operation.kind,
            });
        }
        let language = user_test.language_descriptor.as_ref();
        let managers = compilation_managers(user_test, dataset, language)?;
        Ok(Self {
            operation: operation.clone(),
            task_type: dataset.task_type.clone(),
            task_type_parameters: dataset.task_type_parameters.clone(),
            language: user_test.language.clone(),
            multithreaded_sandbox: user_test.multithreaded_sandbox,
            archive_sandbox: operation.archive_sandbox,
            files: user_test.files.clone(),
            managers,
            info: format!("compile user test {}", user_test.id),
        })
    }
}

/// The managers a user test compilation is given, and the three phases of them.
///
/// The test's own managers are the base; the task type's automatic managers go
/// over them by name, each renamed first when its name ends in the language
/// placeholder and the language is known; and the dataset's headers go over
/// that. The last phase is this path's own, and it is skipped along with the
/// substitution when the language is unknown.
fn compilation_managers(
    user_test: &UserTest,
    dataset: &Dataset,
    language: Option<&Language>,
) -> Result<DigestMap, BuildError> {
    let mut managers = user_test.managers.clone();
    if let Some(auto_managers) = &dataset.auto_managers {
        for name in auto_managers {
            let name = substitute_language(name, language);
            let Some(digest) = dataset.managers.get(&name).cloned() else {
                return Err(BuildError::UnknownManager { name: name.clone() });
            };
            managers.insert(name, digest);
        }
    } else {
        for (name, digest) in &dataset.managers {
            if !managers.contains_key(name) {
                managers.insert(name.clone(), digest.clone());
            }
        }
    }
    if let Some(language) = language {
        add_headers(&mut managers, dataset, language);
    }
    Ok(managers)
}

impl EvaluationJob {
    /// Evaluates a user test, `EvaluationJob.from_user_test`.
    ///
    /// The managers are the merge the two user test paths share, without the
    /// headers the compilation adds. The run is given the test's own input and
    /// no output at all, and both output flags are set, because a user test is
    /// run for what it prints rather than scored.
    ///
    /// # Errors
    ///
    /// [`BuildError::ObjectMismatch`] and [`BuildError::DatasetMismatch`] when
    /// the operation names another object or dataset,
    /// [`BuildError::UnexpectedOperation`] when it is not a user test
    /// evaluation, [`BuildError::UnknownLanguage`] when the test's language
    /// names no known language, and [`BuildError::UnknownManager`] when the
    /// dataset holds no manager the task type's automatic list names.
    pub fn from_user_test(
        operation: &Operation,
        user_test: &UserTest,
        dataset: &Dataset,
    ) -> Result<Self, BuildError> {
        check_scope(operation, user_test.id, dataset.id)?;
        if operation.kind != OperationKind::UserTestEvaluation {
            return Err(BuildError::UnexpectedOperation {
                wanted: OperationKind::UserTestEvaluation,
                found: operation.kind,
            });
        }
        let language = require_language(user_test)?;
        let managers = evaluation_managers(user_test, dataset, language)?;
        Ok(Self {
            operation: operation.clone(),
            task_type: dataset.task_type.clone(),
            task_type_parameters: dataset.task_type_parameters.clone(),
            language: user_test.language.clone(),
            multithreaded_sandbox: user_test.multithreaded_sandbox,
            archive_sandbox: operation.archive_sandbox,
            files: user_test.files.clone(),
            managers,
            executables: user_test.result_executables.clone(),
            input: user_test.input.clone(),
            output: None,
            time_limit: dataset.time_limit,
            memory_limit: dataset.memory_limit,
            only_execution: Some(true),
            get_output: Some(true),
            info: format!("evaluate user test {}", user_test.id),
        })
    }
}

/// The managers a user test evaluation is given, and the two phases of them.
///
/// The same base and the same automatic managers the compilation merges, over
/// the same names renamed the same way. The headers are not a third phase here.
fn evaluation_managers(
    user_test: &UserTest,
    dataset: &Dataset,
    language: &Language,
) -> Result<DigestMap, BuildError> {
    let mut managers = user_test.managers.clone();
    if let Some(auto_managers) = &dataset.auto_managers {
        for name in auto_managers {
            let name = substitute_language(name, Some(language));
            let Some(digest) = dataset.managers.get(&name).cloned() else {
                return Err(BuildError::UnknownManager { name: name.clone() });
            };
            managers.insert(name, digest);
        }
    } else {
        for (name, digest) in &dataset.managers {
            if !managers.contains_key(name) {
                managers.insert(name.clone(), digest.clone());
            }
        }
    }
    Ok(managers)
}

/// Puts the language's source extension where an automatic manager name asked
/// for it, and leaves every other name alone.
fn substitute_language(name: &str, language: Option<&Language>) -> String {
    if !name.ends_with(LANGUAGE_PLACEHOLDER) {
        return name.to_owned();
    }
    let Some(language) = language else {
        return name.to_owned();
    };
    name.replace(LANGUAGE_PLACEHOLDER, &language.source_extension)
}

/// Adds every manager of the dataset the language reads as a header.
fn add_headers(managers: &mut DigestMap, dataset: &Dataset, language: &Language) {
    for (name, digest) in &dataset.managers {
        if language
            .header_extensions
            .iter()
            .any(|header| name.ends_with(header))
        {
            managers.insert(name.clone(), digest.clone());
        }
    }
}

/// The language a user test evaluation cannot be built without.
///
/// The compilation carries on without one, and this path stops instead, naming
/// the language the test was submitted under.
fn require_language(user_test: &UserTest) -> Result<&Language, BuildError> {
    user_test
        .language_descriptor
        .as_ref()
        .ok_or_else(|| BuildError::UnknownLanguage {
            language: user_test.language.clone(),
        })
}
