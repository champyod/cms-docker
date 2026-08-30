use std::error::Error;
use std::process::Command;

pub fn execute_script(script_name: &str) -> Result<i32, Box<dyn Error>> {
    let script_path = format!("../../scripts/{}", script_name);
    let status = Command::new("sh").arg(script_path).status()?;
    Ok(status.code().unwrap_or(-1))
}
