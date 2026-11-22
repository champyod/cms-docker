//! The sentences a contestant is shown for what a run did, and the help that explains
//! them.
//!
//! One table feeds two surfaces: the details of a submission, and the help page that
//! explains every outcome, which prints the entries in the order this table declares
//! them. That order is part of what a reader is shown, so the entries are a slice and a
//! lookup walks it: a map keeps the seconds and loses the firsts.
//!
//! A sentence that names an argument is a different variant from one that does not, and
//! the naming one has no form that leaves this module without its argument, because a
//! `%s` printed to a contestant is what declaring these as loose strings let happen.
//!
//! Every string here is the reference's msgid as `N_()` marks it for translation. The
//! catalogue that translates them is read by the page that prints them, so a sentence
//! leaves here in the language it was declared in and is never re-worded on the way.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

/// A sentence a contestant is shown, and whether it has a hole for one argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sentence {
    /// A sentence that stands on its own.
    Stands(&'static str),
    /// A sentence with one `%s`, which a report fills with one argument.
    Names(&'static str),
}

impl Sentence {
    /// The sentence as it is declared, hole and all, which is what the help page prints:
    /// there the explanation is the declaration rather than an example of it.
    #[must_use]
    pub const fn template(self) -> &'static str {
        match self {
            Self::Stands(sentence) | Self::Names(sentence) => sentence,
        }
    }

    /// The sentence alone, as a report stores a sentence that names nothing.
    ///
    /// # Panics
    ///
    /// For a sentence that names an argument: it has no report without one, and refusing
    /// here is what keeps a `%s` off a contestant's page.
    #[must_use]
    pub fn reported(self) -> Vec<String> {
        match self {
            Self::Stands(sentence) => vec![sentence.to_owned()],
            Self::Names(sentence) => panic!("`{sentence}' names an argument and has none"),
        }
    }

    /// The sentence and the one argument it names, as a report stores them: the sentence
    /// first and the argument second, which is the shape the reference hands over.
    ///
    /// # Panics
    ///
    /// For a sentence that names nothing, which an argument passed here would be dropped
    /// by rather than shown.
    #[must_use]
    pub fn reported_naming(self, argument: &str) -> Vec<String> {
        match self {
            Self::Names(sentence) => vec![sentence.to_owned(), argument.to_owned()],
            Self::Stands(sentence) => panic!("`{sentence}' names no argument and has one"),
        }
    }
}

/// The sentence a job that only asked to be run is answered with.
///
/// Not a table entry: the help page explains outcomes rather than this acknowledgement,
/// which is why the reference declares it beside each task type instead.
pub const EXECUTED: &str = "Execution completed successfully";

/// One outcome message: what the code calls it, what a report shows, and what the help
/// page explains.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HumanMessage {
    shorthand: &'static str,
    message: Sentence,
    help_text: &'static str,
}

impl HumanMessage {
    const fn new(shorthand: &'static str, message: Sentence, help_text: &'static str) -> Self {
        Self {
            shorthand,
            message,
            help_text,
        }
    }

    /// What the code calls this message, which is what [`MessageCollection::get`] is
    /// asked by.
    #[must_use]
    pub const fn shorthand(self) -> &'static str {
        self.shorthand
    }

    /// The sentence, which names its argument where it names one.
    #[must_use]
    pub const fn message(self) -> Sentence {
        self.message
    }

    /// The longer explanation the help page prints beside the sentence.
    #[must_use]
    pub const fn help_text(self) -> &'static str {
        self.help_text
    }
}

/// A table of messages, read by shorthand and printed in the order it is declared.
#[derive(Debug, Clone, Copy)]
pub struct MessageCollection {
    messages: &'static [HumanMessage],
}

impl MessageCollection {
    const fn new(messages: &'static [HumanMessage]) -> Self {
        Self { messages }
    }

    /// The entries as they are declared, which is the order the help page prints them in.
    #[must_use]
    pub const fn all(&self) -> &'static [HumanMessage] {
        self.messages
    }

    /// The entry a shorthand names.
    ///
    /// # Panics
    ///
    /// For a shorthand this table does not hold, with the reference's sentence: every
    /// caller names a shorthand the table declares, so a miss is a mistake in the code
    /// rather than an answer to hand on.
    #[must_use]
    pub fn get(&self, shorthand: &str) -> &'static HumanMessage {
        self.messages
            .iter()
            .find(|message| message.shorthand == shorthand)
            .unwrap_or_else(|| panic!("Trying to get a non-existing message `{shorthand}'."))
    }
}

/// The nine outcomes an evaluation reports, in the order the help page prints them.
pub static EVALUATION_MESSAGES: MessageCollection = MessageCollection::new(&[
    HumanMessage::new(
        "success",
        Sentence::Stands("Output is correct"),
        "Your submission ran and gave the correct answer",
    ),
    HumanMessage::new(
        "partial",
        Sentence::Stands("Output is partially correct"),
        "Your submission ran and gave the partially correct answer",
    ),
    HumanMessage::new(
        "wrong",
        Sentence::Stands("Output isn't correct"),
        "Your submission ran, but gave the wrong answer",
    ),
    HumanMessage::new(
        "nooutput",
        Sentence::Names("Evaluation didn't produce file %s"),
        "Your submission ran, but did not write on the correct output file",
    ),
    HumanMessage::new(
        "timeout",
        Sentence::Stands("Execution timed out"),
        "Your submission used too much CPU time.",
    ),
    HumanMessage::new(
        "walltimeout",
        Sentence::Stands("Execution timed out (wall clock limit exceeded)"),
        "Your submission used too much total time. This might be triggered by undefined \
         code, or buffer overflow, for example. Note that in this case the CPU time visible \
         in the submission details might be much smaller than the time limit.",
    ),
    HumanMessage::new(
        "memorylimit",
        Sentence::Stands("Memory limit exceeded"),
        "Your submission used too much memory.",
    ),
    HumanMessage::new(
        "signal",
        Sentence::Stands("Execution killed by signal"),
        "The evaluation was killed by a signal.",
    ),
    HumanMessage::new(
        "returncode",
        Sentence::Stands("Execution failed because the return code was nonzero"),
        "Your submission failed because it exited with a return code different from 0.",
    ),
]);

/// The four outcomes a compilation reports, in the order the help page prints them.
pub static COMPILATION_MESSAGES: MessageCollection = MessageCollection::new(&[
    HumanMessage::new(
        "success",
        Sentence::Stands("Compilation succeeded"),
        "Your submission successfully compiled to an executable.",
    ),
    HumanMessage::new(
        "fail",
        Sentence::Stands("Compilation failed"),
        "Your submission did not compile correctly.",
    ),
    HumanMessage::new(
        "timeout",
        Sentence::Stands("Compilation timed out"),
        "Your submission exceeded the time limit while compiling. This might be caused by an \
         excessive use of C++ templates, for example.",
    ),
    HumanMessage::new(
        "signal",
        Sentence::Names(
            "Compilation killed with signal %s (could be triggered by violating memory limits)",
        ),
        "Your submission was killed with the specified signal. Among other things, this might \
         be caused by exceeding the memory limit for the compilation, and in turn by an \
         excessive use of C++ templates, for example.",
    ),
]);
