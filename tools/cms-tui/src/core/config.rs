use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Error for configuration file reads and parses.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid .env line {line}: {content}")]
    EnvParse { line: usize, content: String },
    #[error("invalid TOML: {0}")]
    Toml(#[from] toml::de::Error),
}

/// Parses a dotenv-style file into an ordered key-value map.
///
/// Skips blank lines and `#` comments; strips an optional `export ` prefix so
/// values written for shells are loaded into the map unchanged.
///
/// # Errors
///
/// Returns `Err` if the file cannot be read or a line lacks `=` separator.
pub fn read_env_file(path: &Path) -> Result<BTreeMap<String, String>, ConfigError> {
    let content = fs::read_to_string(path)?;
    let mut map = BTreeMap::new();
    for (index, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            return Err(ConfigError::EnvParse {
                line: index + 1,
                content: raw_line.to_string(),
            });
        };
        map.insert(key.trim().to_string(), value.trim().to_string());
    }
    Ok(map)
}

/// Reads and parses a TOML configuration file into a generic value tree.
///
/// # Errors
///
/// Returns `Err` if the file cannot be read or contains invalid TOML.
pub fn read_toml(path: &Path) -> Result<toml::Value, ConfigError> {
    let content = fs::read_to_string(path)?;
    Ok(toml::from_str(&content)?)
}

/// Returns the content of the CMS config file, or an actionable fallback
/// message when the file has not been generated yet (mirrors `cms config show`).
///
/// # Errors
///
/// Returns `Err` if the file exists but cannot be read.
pub fn config_show(path: &Path) -> Result<String, ConfigError> {
    if path.is_file() {
        return fs::read_to_string(path).map_err(ConfigError::Io);
    }
    Ok("No config.toml — run: ./cms config sync".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cms_config_{label}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn read_env_file_parses_values_and_skips_comments() {
        let dir = scratch_dir("env");
        let path = dir.join(".env.test");
        fs::write(
            &path,
            "# a comment\nKEY_ONE=value1\nexport KEY_TWO=value2\n\nKEY_SPACED =  spaced  \n",
        )
        .expect("write env");
        let map = read_env_file(&path).expect("parse env");
        assert_eq!(map.get("KEY_ONE").map(String::as_str), Some("value1"));
        assert_eq!(map.get("KEY_TWO").map(String::as_str), Some("value2"));
        assert_eq!(map.get("KEY_SPACED").map(String::as_str), Some("spaced"));
        assert_eq!(map.len(), 3);
    }

    #[test]
    fn read_env_file_reports_malformed_line() {
        let dir = scratch_dir("envbad");
        let path = dir.join(".env.test");
        fs::write(&path, "GOOD=1\nNOT_A_PAIR\n").expect("write env");
        assert!(matches!(
            read_env_file(&path),
            Err(ConfigError::EnvParse { line: 2, .. })
        ));
    }

    #[test]
    fn read_toml_parses_structure() {
        let dir = scratch_dir("toml");
        let path = dir.join("cms.toml");
        fs::write(&path, "title = \"demo\"\n[core]\nworkers = 4\n").expect("write toml");
        let value = read_toml(&path).expect("parse toml");
        assert_eq!(value["title"].as_str(), Some("demo"));
        assert_eq!(value["core"]["workers"].as_integer(), Some(4));
    }

    #[test]
    fn read_toml_rejects_invalid() {
        let dir = scratch_dir("tomlbad");
        let path = dir.join("bad.toml");
        fs::write(&path, "this is = = not == toml").expect("write toml");
        assert!(matches!(read_toml(&path), Err(ConfigError::Toml(_))));
    }

    #[test]
    fn config_show_returns_fallback_when_missing() {
        let dir = scratch_dir("show_missing");
        let result = config_show(&dir.join("config.toml")).expect("no error");
        assert!(result.contains("No config.toml"));
    }

    #[test]
    fn config_show_returns_content_when_present() {
        let dir = scratch_dir("show_present");
        let path = dir.join("config.toml");
        fs::write(&path, "title = \"demo\"").expect("write config");
        assert_eq!(config_show(&path).expect("read config"), "title = \"demo\"");
    }
}
