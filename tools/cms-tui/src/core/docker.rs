use std::error::Error;

pub struct DockerClient;

impl DockerClient {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        Ok(Self)
    }

    pub fn stack_command(&self, _command: &str, _target: &str) -> Result<(), Box<dyn Error>> {
        Ok(())
    }
}
