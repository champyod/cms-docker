//! The two task columns whose values are a fixed set rather than a number.

/// What a contestant may see about an evaluation (`tasks.feedback_level`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedbackLevel {
    /// Killing signal, time, memory and every testcase: offering this helps reverse the task data.
    Full,
    /// No killing signal or resources, and testcases may be left out.
    Restricted,
    /// The narrowed set the IOI contest rules allow.
    OiRestricted,
}

impl FeedbackLevel {
    /// The value the `feedback_level` enum stores.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Restricted => "restricted",
            Self::OiRestricted => "oi_restricted",
        }
    }

    /// The level a column value names, or `None` for one the enum does not declare.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "full" => Some(Self::Full),
            "restricted" => Some(Self::Restricted),
            "oi_restricted" => Some(Self::OiRestricted),
            _ => None,
        }
    }
}

/// How a task's submissions are turned into one score (`tasks.score_mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScoreMode {
    /// The last submission the contestant played a token on, or the last if none was.
    MaxTokenedLast,
    /// The maximum over every submission.
    Max,
    /// The maximum over each subtask, summed.
    MaxSubtask,
}

impl ScoreMode {
    /// The value the `score_mode` enum stores.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MaxTokenedLast => "max_tokened_last",
            Self::Max => "max",
            Self::MaxSubtask => "max_subtask",
        }
    }

    /// The mode a column value names, or `None` for one the enum does not declare.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "max_tokened_last" => Some(Self::MaxTokenedLast),
            "max" => Some(Self::Max),
            "max_subtask" => Some(Self::MaxSubtask),
            _ => None,
        }
    }
}
