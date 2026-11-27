#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessMode {
    Public,
    Protected,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("access_mode must be public or protected, got {0:?}")]
pub struct InvalidAccessMode(pub String);

impl AccessMode {
    pub fn parse(value: &str) -> Result<Self, InvalidAccessMode> {
        match value {
            "public" => Ok(Self::Public),
            "protected" => Ok(Self::Protected),
            other => Err(InvalidAccessMode(other.to_string())),
        }
    }

    /// An unknown stored value is protected: a damaged setting must not open the board.
    pub fn from_stored(value: &str) -> Self {
        Self::parse(value).unwrap_or(Self::Protected)
    }

    pub fn is_protected(self) -> bool {
        self == Self::Protected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_stored_values_map_to_their_modes() {
        assert_eq!(AccessMode::parse("public"), Ok(AccessMode::Public));
        assert_eq!(AccessMode::parse("protected"), Ok(AccessMode::Protected));
    }

    #[test]
    fn an_unknown_stored_value_is_protected() {
        for value in ["", "Public", "protected ", "prod", "true"] {
            assert_eq!(AccessMode::from_stored(value), AccessMode::Protected);
        }
    }

    #[test]
    fn only_the_exact_public_value_is_public() {
        assert!(!AccessMode::from_stored("public").is_protected());
        assert!(AccessMode::from_stored("Public").is_protected());
    }

    #[test]
    fn an_invalid_value_names_itself() {
        assert_eq!(
            AccessMode::parse("weird"),
            Err(InvalidAccessMode("weird".to_string()))
        );
    }
}
