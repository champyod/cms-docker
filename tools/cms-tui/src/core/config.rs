use std::fs;
use std::error::Error;

pub fn read_config(path: &str) -> Result<String, Box<dyn Error>> {
    let content = fs::read_to_string(path)?;
    Ok(content)
}

pub fn write_config(path: &str, content: &str) -> Result<(), Box<dyn Error>> {
    fs::write(path, content)?;
    Ok(())
}
