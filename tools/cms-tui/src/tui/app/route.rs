use std::fmt;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Route {
    Dashboard,
    Stacks,
    Database,
    Worker,
    Ingress,
    /// The per-UI exposure chooser, reached from the Ingress page.
    ///
    /// WHY its own route rather than a mode flag on Ingress: the chooser needs its own
    /// cursor pair and its own key meanings, and folding it into Ingress would mean one
    /// page answering for two unrelated sets of keys.
    Exposure,
    /// The `__domain.sh setup` form, reached from the Ingress page.
    ///
    /// WHY its own route rather than a mode flag on Ingress: the form has twenty-odd
    /// focusable rows and an arming step, so its key meanings have nothing in common with
    /// a one-line action menu, and folding them together would mean one page answering
    /// for two unrelated sets of keys.
    Domain,
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
            Self::Exposure => write!(f, "Exposure"),
            Self::Domain => write!(f, "Domain"),
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
