//! The environment a worker is started with, read once before its listener opens.
//!
//! The deployment already renders the worker's shard, sandbox limits and shared
//! paths into environment variables. This module gives those inputs names and
//! types without reading a configuration file or reaching for a second parser.
//! An absent optional input keeps the reference default; an input that is set
//! but unusable is refused with its variable and value rather than replaced.
//!
//! # Errors
//!
//! [`Settings::from_env`] returns [`SettingsError`] for a missing secret, an
//! empty path or address, a malformed number or an amount that cannot be held
//! by the grading runtime. Nothing is bound and no directory is created until
//! every input has been read.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use cms_grading::steps::TrustedLimits;
use cms_grading::tasktypes::CompilationLimits;
use cms_proto::Shard;

const SHARD_VARIABLE: &str = "WORKER_SHARD";
const BIND_ADDRESS_VARIABLE: &str = "WORKER_BIND_ADDR";
const PORT_VARIABLE: &str = "WORKER_PORT";
const SECRET_VARIABLE: &str = "RPC_SECRET";
const DATABASE_URL_VARIABLE: &str = "DATABASE_URL";
const CACHE_DIR_VARIABLE: &str = "CMS_CACHE_DIR";
const TEMP_DIR_VARIABLE: &str = "CMS_TEMP_DIR";
const SANDBOX_PROGRAM_VARIABLE: &str = "CMS_SANDBOX_PROGRAM";
const KEEP_SANDBOX_VARIABLE: &str = "KEEP_SANDBOX";
const MAX_FILE_SIZE_VARIABLE: &str = "MAX_FILE_SIZE";
const COMPILATION_PROCESSES_VARIABLE: &str = "COMPILATION_SANDBOX_MAX_PROCESSES";
const COMPILATION_TIME_VARIABLE: &str = "COMPILATION_SANDBOX_MAX_TIME_S";
const COMPILATION_MEMORY_VARIABLE: &str = "COMPILATION_SANDBOX_MAX_MEMORY_KIB";
const TRUSTED_PROCESSES_VARIABLE: &str = "TRUSTED_SANDBOX_MAX_PROCESSES";
const TRUSTED_TIME_VARIABLE: &str = "TRUSTED_SANDBOX_MAX_TIME_S";
const TRUSTED_MEMORY_VARIABLE: &str = "TRUSTED_SANDBOX_MAX_MEMORY_KIB";

const DEFAULT_SHARD: i64 = 0;
const DEFAULT_BIND_ADDRESS: &str = "0.0.0.0";
const DEFAULT_PORT: u16 = 26_000;
const DEFAULT_CACHE_DIR: &str = "/var/local/cache/cms";
const DEFAULT_TEMP_DIR: &str = "/tmp";
const DEFAULT_SANDBOX_PROGRAM: &str = "isolate";
const DEFAULT_MAX_FILE_SIZE_KIB: u64 = 1_048_576;
const DEFAULT_COMPILATION_PROCESSES: u32 = 1000;
const DEFAULT_COMPILATION_TIME: Duration = Duration::from_secs(10);
const DEFAULT_COMPILATION_MEMORY_KIB: u64 = 524_288;
const DEFAULT_TRUSTED_PROCESSES: u32 = 1000;
const DEFAULT_TRUSTED_TIME: Duration = Duration::from_secs(10);
const DEFAULT_TRUSTED_MEMORY_KIB: u64 = 4_194_304;
const BYTES_PER_KIB: u64 = 1024;
const SHARED_FILE_DIR_COMPONENT: &str = "fs-cache-shared";

/// The typed inputs one worker carries from its environment into the runtime.
#[derive(Clone, PartialEq, Eq)]
pub struct Settings {
    /// The index this worker stamps onto every job it runs.
    pub shard: Shard,
    /// The address the RPC listener binds.
    pub bind_address: SocketAddr,
    /// The shared secret every caller must present.
    pub secret: String,
    /// The database URL precaching uses, absent on workers that only run jobs.
    pub database_url: Option<String>,
    /// The directory holding files shared with the other services.
    pub cache_dir: PathBuf,
    /// The directory under which sandbox boxes are made.
    pub temp_dir: PathBuf,
    /// The isolation program used to launch a box.
    pub sandbox_program: PathBuf,
    /// Whether successful sandbox boxes are kept for inspection.
    pub keep_sandbox: bool,
    /// The largest file an evaluation may create, or no bound when set to zero.
    pub max_file_size: Option<u64>,
    /// The limits applied to every compilation.
    pub compilation_limits: CompilationLimits,
    /// The limits applied to every trusted step.
    pub trusted_limits: TrustedLimits,
}

impl Settings {
    /// Reads the worker's environment, keeping defaults only for absent inputs.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError`] when a required input is absent or an input is
    /// set to a value the worker cannot use.
    pub fn from_env() -> Result<Self, SettingsError> {
        Ok(Self {
            shard: shard()?,
            bind_address: bind_address()?,
            secret: required_text(SECRET_VARIABLE)?,
            database_url: database_url()?,
            cache_dir: PathBuf::from(text(CACHE_DIR_VARIABLE, DEFAULT_CACHE_DIR)?),
            temp_dir: PathBuf::from(text(TEMP_DIR_VARIABLE, DEFAULT_TEMP_DIR)?),
            sandbox_program: PathBuf::from(text(
                SANDBOX_PROGRAM_VARIABLE,
                DEFAULT_SANDBOX_PROGRAM,
            )?),
            keep_sandbox: keep_sandbox()?,
            max_file_size: max_file_size()?,
            compilation_limits: compilation_limits()?,
            trusted_limits: trusted_limits()?,
        })
    }

    /// The directory where the shared file cacher stores files by digest.
    #[must_use]
    pub fn shared_file_dir(&self) -> PathBuf {
        self.cache_dir.join(SHARED_FILE_DIR_COMPONENT)
    }
}

/// Why an environment input could not become a worker setting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    /// A required variable was not set.
    Missing {
        /// The variable the worker needs.
        variable: &'static str,
    },
    /// A variable was set to a value the worker cannot use.
    Invalid {
        /// The variable carrying the unusable value.
        variable: &'static str,
        /// The refused value, or its lossy text when the environment was not UTF-8.
        value: String,
        /// Why the value cannot be used.
        reason: &'static str,
    },
}

impl fmt::Display for SettingsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing { variable } => write!(
                formatter,
                "{variable} is unset (<unset>); the worker needs it set and will not invent one"
            ),
            Self::Invalid {
                variable,
                value,
                reason,
            } => write!(
                formatter,
                "{variable} has invalid value {value:?}: {reason}"
            ),
        }
    }
}

impl std::error::Error for SettingsError {}

fn shard() -> Result<Shard, SettingsError> {
    let value = text(SHARD_VARIABLE, &DEFAULT_SHARD.to_string())?;
    let index = value
        .parse::<i64>()
        .map_err(|_| invalid(SHARD_VARIABLE, value.clone(), "it is not an i64"))?;
    if index < 0 {
        return Err(invalid(SHARD_VARIABLE, value, "it is negative"));
    }
    Ok(Shard::new(index))
}

fn bind_address() -> Result<SocketAddr, SettingsError> {
    let value = text(BIND_ADDRESS_VARIABLE, DEFAULT_BIND_ADDRESS)?;
    let address = value
        .parse::<IpAddr>()
        .map_err(|_| invalid(BIND_ADDRESS_VARIABLE, value, "it is not an IP address"))?;
    let port = number::<u16>(
        PORT_VARIABLE,
        &DEFAULT_PORT.to_string(),
        "it is not a port between 0 and 65535",
    )?;
    Ok(SocketAddr::new(address, port))
}

fn keep_sandbox() -> Result<bool, SettingsError> {
    let value = read_text(KEEP_SANDBOX_VARIABLE, Some("false"))?;
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        _ => Err(invalid(
            KEEP_SANDBOX_VARIABLE,
            value,
            "it is not true, false, 1 or 0",
        )),
    }
}

fn max_file_size() -> Result<Option<u64>, SettingsError> {
    let bytes = kib_bytes(
        MAX_FILE_SIZE_VARIABLE,
        &DEFAULT_MAX_FILE_SIZE_KIB.to_string(),
    )?;
    Ok((bytes != 0).then_some(bytes))
}

fn compilation_limits() -> Result<CompilationLimits, SettingsError> {
    Ok(CompilationLimits {
        time: Some(seconds(
            COMPILATION_TIME_VARIABLE,
            &DEFAULT_COMPILATION_TIME.as_secs_f64().to_string(),
        )?),
        memory: Some(kib_bytes(
            COMPILATION_MEMORY_VARIABLE,
            &DEFAULT_COMPILATION_MEMORY_KIB.to_string(),
        )?),
        processes: Some(number::<u32>(
            COMPILATION_PROCESSES_VARIABLE,
            &DEFAULT_COMPILATION_PROCESSES.to_string(),
            "it is not a u32",
        )?),
    })
}

fn trusted_limits() -> Result<TrustedLimits, SettingsError> {
    Ok(TrustedLimits::new(
        number::<u32>(
            TRUSTED_PROCESSES_VARIABLE,
            &DEFAULT_TRUSTED_PROCESSES.to_string(),
            "it is not a u32",
        )?,
        seconds(
            TRUSTED_TIME_VARIABLE,
            &DEFAULT_TRUSTED_TIME.as_secs_f64().to_string(),
        )?,
        kib_bytes(
            TRUSTED_MEMORY_VARIABLE,
            &DEFAULT_TRUSTED_MEMORY_KIB.to_string(),
        )?,
    ))
}

fn database_url() -> Result<Option<String>, SettingsError> {
    let Some(value) = std::env::var_os(DATABASE_URL_VARIABLE) else {
        return Ok(None);
    };
    let value = value
        .into_string()
        .map_err(|value| SettingsError::Invalid {
            variable: DATABASE_URL_VARIABLE,
            value: value.to_string_lossy().into_owned(),
            reason: "it is not valid UTF-8",
        })?;
    nonempty(DATABASE_URL_VARIABLE, value).map(Some)
}

fn required_text(name: &'static str) -> Result<String, SettingsError> {
    nonempty(name, read_text(name, None)?)
}

fn text(name: &'static str, default: &str) -> Result<String, SettingsError> {
    nonempty(name, read_text(name, Some(default))?)
}

fn nonempty(name: &'static str, value: String) -> Result<String, SettingsError> {
    if value.trim().is_empty() {
        return Err(invalid(name, value, "it is empty"));
    }
    Ok(value)
}

fn read_text(name: &'static str, default: Option<&str>) -> Result<String, SettingsError> {
    match std::env::var_os(name) {
        None => default
            .map(str::to_owned)
            .ok_or(SettingsError::Missing { variable: name }),
        Some(value) => value.into_string().map_err(|value| SettingsError::Invalid {
            variable: name,
            value: value.to_string_lossy().into_owned(),
            reason: "it is not valid UTF-8",
        }),
    }
}

fn number<T: FromStr>(
    name: &'static str,
    default: &str,
    reason: &'static str,
) -> Result<T, SettingsError> {
    let value = text(name, default)?;
    value.parse().map_err(|_| invalid(name, value, reason))
}

fn seconds(name: &'static str, default: &str) -> Result<Duration, SettingsError> {
    let value = text(name, default)?;
    let seconds = value
        .parse::<f64>()
        .map_err(|_| invalid(name, value.clone(), "it is not a number of seconds"))?;
    Duration::try_from_secs_f64(seconds)
        .map_err(|_| invalid(name, value, "it is not finite and non-negative"))
}

fn kib_bytes(name: &'static str, default: &str) -> Result<u64, SettingsError> {
    let value = text(name, default)?;
    let kib = value
        .parse::<u64>()
        .map_err(|_| invalid(name, value.clone(), "it is not a u64"))?;
    kib.checked_mul(BYTES_PER_KIB)
        .ok_or_else(|| invalid(name, value, "it does not fit in a byte count"))
}

fn invalid(name: &'static str, value: String, reason: &'static str) -> SettingsError {
    SettingsError::Invalid {
        variable: name,
        value,
        reason,
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};
    use std::time::Duration;

    use super::Settings;

    const SECRET_VARIABLE: &str = "RPC_SECRET";
    const DATABASE_URL_VARIABLE: &str = "DATABASE_URL";
    const KEEP_SANDBOX_VARIABLE: &str = "KEEP_SANDBOX";
    const VARIABLES: [&str; 16] = [
        "WORKER_SHARD",
        "WORKER_BIND_ADDR",
        "WORKER_PORT",
        SECRET_VARIABLE,
        DATABASE_URL_VARIABLE,
        "CMS_CACHE_DIR",
        "CMS_TEMP_DIR",
        "CMS_SANDBOX_PROGRAM",
        KEEP_SANDBOX_VARIABLE,
        "MAX_FILE_SIZE",
        "COMPILATION_SANDBOX_MAX_PROCESSES",
        "COMPILATION_SANDBOX_MAX_TIME_S",
        "COMPILATION_SANDBOX_MAX_MEMORY_KIB",
        "TRUSTED_SANDBOX_MAX_PROCESSES",
        "TRUSTED_SANDBOX_MAX_TIME_S",
        "TRUSTED_SANDBOX_MAX_MEMORY_KIB",
    ];
    const SECRET: &str = "worker test secret";

    static ENVIRONMENT: Mutex<()> = Mutex::new(());

    struct Environment {
        saved: Vec<(&'static str, Option<OsString>)>,
    }

    impl Environment {
        fn clean() -> Self {
            let saved = VARIABLES
                .into_iter()
                .map(|name| (name, std::env::var_os(name)))
                .collect();
            for name in VARIABLES {
                std::env::remove_var(name);
            }
            Self { saved }
        }

        fn set(&self, name: &'static str, value: &str) {
            std::env::set_var(name, value);
        }
    }

    impl Drop for Environment {
        fn drop(&mut self) {
            for (name, value) in &self.saved {
                if let Some(value) = value {
                    std::env::set_var(name, value);
                } else {
                    std::env::remove_var(name);
                }
            }
        }
    }

    fn serial_environment() -> MutexGuard<'static, ()> {
        ENVIRONMENT
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[test]
    fn defaults_match_the_sample_configuration() {
        let _serial = serial_environment();
        let environment = Environment::clean();
        environment.set(SECRET_VARIABLE, SECRET);

        let settings = Settings::from_env().expect("the secret is the only required input");

        assert_eq!(settings.shard.get(), 0);
        assert_eq!(settings.bind_address.to_string(), "0.0.0.0:26000");
        assert_eq!(settings.secret, SECRET);
        assert_eq!(settings.database_url, None);
        assert_eq!(settings.cache_dir, PathBuf::from("/var/local/cache/cms"));
        assert_eq!(settings.temp_dir, PathBuf::from("/tmp"));
        assert_eq!(settings.sandbox_program, PathBuf::from("isolate"));
        assert!(!settings.keep_sandbox);
        assert_eq!(settings.max_file_size, Some(1_048_576 * 1024));
        assert_eq!(settings.compilation_limits.processes, Some(1000));
        assert_eq!(
            settings.compilation_limits.time,
            Some(std::time::Duration::from_secs(10))
        );
        assert_eq!(settings.compilation_limits.memory, Some(524_288 * 1024));
        assert_eq!(settings.trusted_limits.processes, 1000);
        assert_eq!(
            settings.trusted_limits.time,
            std::time::Duration::from_secs(10)
        );
        assert_eq!(settings.trusted_limits.memory, 4_194_304 * 1024);
    }

    #[test]
    fn shared_file_dir_joins_the_reference_component() {
        let _serial = serial_environment();
        let environment = Environment::clean();
        environment.set(SECRET_VARIABLE, SECRET);
        environment.set("CMS_CACHE_DIR", "/srv/cache");

        let settings = Settings::from_env().expect("the cache root is valid");

        assert_eq!(settings.cache_dir, PathBuf::from("/srv/cache"));
        assert_eq!(
            settings.shared_file_dir(),
            PathBuf::from("/srv/cache/fs-cache-shared")
        );
    }

    #[test]
    fn valid_overrides_replace_every_default() {
        let _serial = serial_environment();
        let environment = Environment::clean();
        environment.set("WORKER_SHARD", "3");
        environment.set("WORKER_BIND_ADDR", "127.0.0.1");
        environment.set("WORKER_PORT", "26001");
        environment.set(SECRET_VARIABLE, "override secret");
        environment.set(DATABASE_URL_VARIABLE, "postgresql://worker@localhost/cms");
        environment.set("CMS_CACHE_DIR", "/srv/cache");
        environment.set("CMS_TEMP_DIR", "/srv/tmp");
        environment.set("CMS_SANDBOX_PROGRAM", "/usr/bin/isolate");
        environment.set("MAX_FILE_SIZE", "2048");
        environment.set("COMPILATION_SANDBOX_MAX_PROCESSES", "17");
        environment.set("COMPILATION_SANDBOX_MAX_TIME_S", "2.5");
        environment.set("COMPILATION_SANDBOX_MAX_MEMORY_KIB", "262144");
        environment.set("TRUSTED_SANDBOX_MAX_PROCESSES", "19");
        environment.set("TRUSTED_SANDBOX_MAX_TIME_S", "3.5");
        environment.set("TRUSTED_SANDBOX_MAX_MEMORY_KIB", "524288");

        let settings = Settings::from_env().expect("every override is valid");

        assert_eq!(settings.shard.get(), 3);
        assert_eq!(settings.bind_address.to_string(), "127.0.0.1:26001");
        assert_eq!(settings.secret, "override secret");
        assert_eq!(
            settings.database_url.as_deref(),
            Some("postgresql://worker@localhost/cms")
        );
        assert_eq!(settings.cache_dir, PathBuf::from("/srv/cache"));
        assert_eq!(settings.temp_dir, PathBuf::from("/srv/tmp"));
        assert_eq!(settings.sandbox_program, PathBuf::from("/usr/bin/isolate"));
        assert_eq!(settings.max_file_size, Some(2048 * 1024));
        assert_eq!(settings.compilation_limits.processes, Some(17));
        assert_eq!(
            settings.compilation_limits.time,
            Some(Duration::from_secs_f64(2.5))
        );
        assert_eq!(settings.compilation_limits.memory, Some(262_144 * 1024));
        assert_eq!(settings.trusted_limits.processes, 19);
        assert_eq!(settings.trusted_limits.time, Duration::from_secs_f64(3.5));
        assert_eq!(settings.trusted_limits.memory, 524_288 * 1024);
    }

    #[test]
    fn zero_max_file_size_removes_the_bound() {
        let _serial = serial_environment();
        let environment = Environment::clean();
        environment.set(SECRET_VARIABLE, SECRET);
        environment.set("MAX_FILE_SIZE", "0");

        let settings = Settings::from_env().expect("zero is a valid file-size setting");

        assert_eq!(settings.max_file_size, None);
    }

    #[test]
    fn keep_sandbox_accepts_the_reference_boolean_forms() {
        for (value, expected) in [
            ("true", true),
            ("TRUE", true),
            ("TrUe", true),
            ("1", true),
            ("false", false),
            ("FALSE", false),
            ("FaLsE", false),
            ("0", false),
        ] {
            let _serial = serial_environment();
            let environment = Environment::clean();
            environment.set(SECRET_VARIABLE, SECRET);
            environment.set(KEEP_SANDBOX_VARIABLE, value);

            let settings = Settings::from_env().expect("the boolean form is valid");

            assert_eq!(settings.keep_sandbox, expected, "{value}");
        }
    }

    #[test]
    fn malformed_keep_sandbox_is_refused_by_name_and_value() {
        let message = refusal_for(KEEP_SANDBOX_VARIABLE, "yes");

        assert!(message.contains(KEEP_SANDBOX_VARIABLE), "{message}");
        assert!(message.contains("yes"), "{message}");
    }

    #[test]
    fn blank_database_url_is_refused_by_name_and_value() {
        let message = refusal_for(DATABASE_URL_VARIABLE, "   ");

        assert!(message.contains(DATABASE_URL_VARIABLE), "{message}");
        assert!(message.contains("\"   \""), "{message}");
    }

    #[test]
    fn malformed_worker_port_is_refused_by_name_and_value() {
        let message = refusal_for("WORKER_PORT", "not-a-port");

        assert!(message.contains("WORKER_PORT"), "{message}");
        assert!(message.contains("not-a-port"), "{message}");
    }

    #[test]
    fn negative_worker_shard_is_refused_by_name_and_value() {
        let message = refusal_for("WORKER_SHARD", "-1");

        assert!(message.contains("WORKER_SHARD"), "{message}");
        assert!(message.contains("-1"), "{message}");
    }

    #[test]
    fn malformed_max_file_size_is_refused_by_name_and_value() {
        let message = refusal_for("MAX_FILE_SIZE", "not-a-size");

        assert!(message.contains("MAX_FILE_SIZE"), "{message}");
        assert!(message.contains("not-a-size"), "{message}");
    }

    #[test]
    fn missing_rpc_secret_is_refused_by_name() {
        let _serial = serial_environment();
        let _environment = Environment::clean();

        let error = match Settings::from_env() {
            Err(error) => error,
            Ok(_) => panic!("a worker cannot start without a secret"),
        };
        let message = error.to_string();

        assert!(message.contains("RPC_SECRET"), "{message}");
        assert!(message.contains("<unset>"), "{message}");
    }

    #[test]
    fn blank_rpc_secret_is_refused_with_its_value() {
        let message = refusal_for("RPC_SECRET", "");

        assert!(message.contains("RPC_SECRET"), "{message}");
        assert!(message.contains("\"\""), "{message}");
    }

    #[test]
    fn malformed_sandbox_limits_are_refused_by_name_and_value() {
        for (variable, value) in [
            ("COMPILATION_SANDBOX_MAX_PROCESSES", "many"),
            ("COMPILATION_SANDBOX_MAX_TIME_S", "NaN"),
            ("COMPILATION_SANDBOX_MAX_MEMORY_KIB", "18446744073709551615"),
            ("TRUSTED_SANDBOX_MAX_PROCESSES", "many"),
            ("TRUSTED_SANDBOX_MAX_TIME_S", "-1"),
            ("TRUSTED_SANDBOX_MAX_MEMORY_KIB", "18446744073709551615"),
        ] {
            let message = refusal_for(variable, value);
            assert!(message.contains(variable), "{message}");
            assert!(message.contains(value), "{message}");
        }
    }

    fn refusal_for(variable: &'static str, value: &str) -> String {
        let _serial = serial_environment();
        let environment = Environment::clean();
        environment.set(SECRET_VARIABLE, SECRET);
        environment.set(variable, value);
        match Settings::from_env() {
            Err(error) => error.to_string(),
            Ok(_) => panic!("a malformed input must not fall back to a default"),
        }
    }
}
