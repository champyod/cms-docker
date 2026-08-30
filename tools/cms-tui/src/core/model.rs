use serde::{Deserialize, Serialize};

/// Represents the high-level domains in your CMS ecosystem.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Environment {
    Core,
    Contest,
    Admin,
    Worker,
    Infra,
    Monitoring,
}

impl std::fmt::Display for Environment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Environment::Core => write!(f, "Core"),
            Environment::Contest => write!(f, "Contest"),
            Environment::Admin => write!(f, "Admin"),
            Environment::Worker => write!(f, "Worker"),
            Environment::Infra => write!(f, "Infra"),
            Environment::Monitoring => write!(f, "Monitoring"),
        }
    }
}

/// A single running component within an environment (e.g., `Postgres`, `AdminWeb`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: String,       // Internal ID (e.g., "postgres", "admin-web")
    pub name: String,     // Display name (e.g., "Postgres Database")
    pub env: Environment, // Which environment it belongs to
    pub status: ServiceStatus,
    pub version: String,  // Version of image or service
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ServiceStatus {
    Up,
    Down,
    Running,
    Paused,
    Unknown,
}

/// A configuration file managed by the system (e.g., `.env.core`, `cms.conf`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFile {
    pub id: String,       // Internal identifier (e.g., "env-core", "cms-conf")
    pub name: String,     // Display name (e.g., ".env for Core")
    pub path: String,     // Relative path to the file (e.g., ".env.core")
    pub syntax: String,   // For syntax highlighting (e.g., "dotenv", "toml", "nginx")
}

/// An executable task or script (e.g., `make core`, `__backup.sh`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,          // Internal ID (e.g., "docker-up-core")
    pub name: String,        // Display name (e.g., "Start Core Services")
    pub command: String,     // The actual command/script to run (e.g., "make core")
    pub category: TaskType,  // For grouping in UI
    pub requires_sudo: bool, // Does this task require elevated privileges?
    pub requires_tty: bool, // Does this task produce interactive or verbose output needing a TTY?
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskType {
    DockerControl,
    DBOperation,
    Security,
    Backup,
    Audit,
    Other,
}

/// The overarching application state.
pub struct AppState {
    pub services: Vec<Service>,
    pub configs: Vec<ConfigFile>,
    pub tasks: Vec<Task>,
}

impl AppState {
    /// Initializes the state with the static data model of the CMS.
    pub fn new() -> Self {
        Self {
            services: vec![
                Service {
                    id: "postgres".to_string(),
                    name: "Postgres Database".to_string(),
                    env: Environment::Core,
                    status: ServiceStatus::Unknown,
                    version: "15".to_string(),
                },
                Service {
                    id: "logservice".to_string(),
                    name: "Log Service".to_string(),
                    env: Environment::Core,
                    status: ServiceStatus::Unknown,
                    version: "latest".to_string(),
                },
                Service {
                    id: "admin-web".to_string(),
                    name: "Admin Web Server".to_string(),
                    env: Environment::Admin,
                    status: ServiceStatus::Unknown,
                    version: "latest".to_string(),
                },
                Service {
                    id: "contest-web".to_string(),
                    name: "Contest Web Server".to_string(),
                    env: Environment::Contest,
                    status: ServiceStatus::Unknown,
                    version: "latest".to_string(),
                },
            ],
            configs: vec![
                ConfigFile {
                    id: "env-core".to_string(),
                    name: "Core Environment".to_string(),
                    path: ".env.core".to_string(),
                    syntax: "dotenv".to_string(),
                },
                ConfigFile {
                    id: "cms-conf".to_string(),
                    name: "CMS Configuration".to_string(),
                    path: "cms.conf.sample".to_string(),
                    syntax: "toml".to_string(),
                },
            ],
            tasks: vec![
                Task {
                    id: "make-core".to_string(),
                    name: "Deploy Core Stack".to_string(),
                    command: "make core".to_string(),
                    category: TaskType::DockerControl,
                    requires_sudo: false,
                    requires_tty: true, // docker-compose up produces verbose output
                },
                Task {
                    id: "backup".to_string(),
                    name: "Run Backup".to_string(),
                    command: "make backup".to_string(),
                    category: TaskType::Backup,
                    requires_sudo: true,
                    requires_tty: true,
                },
                Task {
                    id: "init-db".to_string(),
                    name: "Initialize Database".to_string(),
                    command: "make cms-init".to_string(),
                    category: TaskType::DBOperation,
                    requires_sudo: false,
                    requires_tty: true,
                },
            ],
        }
    }
}
