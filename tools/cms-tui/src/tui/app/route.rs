use std::fmt;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Route {
    Dashboard,
    Stacks,
    Database,
    Worker,
    Ingress,
    Config,
    Backup,
    System,
    Bootstrap,
    Logs,
}

impl fmt::Display for Route {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Dashboard => write!(f, "Dashboard"),
            Self::Stacks => write!(f, "Stacks"),
            Self::Database => write!(f, "Database"),
            Self::Worker => write!(f, "Worker"),
            Self::Ingress => write!(f, "Ingress"),
            Self::Config => write!(f, "Config"),
            Self::Backup => write!(f, "Backup"),
            Self::System => write!(f, "System"),
            Self::Bootstrap => write!(f, "Bootstrap"),
            Self::Logs => write!(f, "Logs"),
        }
    }
}

#[derive(PartialEq, Eq, Debug, Clone)]
pub enum WorkingPopup {
    Blinking,
    TtyDropped,
}
