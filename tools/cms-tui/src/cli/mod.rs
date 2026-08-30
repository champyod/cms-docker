use clap::Subcommand;
use std::error::Error;
use crate::core::docker::DockerClient;
use crate::core::scripts::execute_script;

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Deploy CMS components
    Deploy {
        #[arg(short, long)]
        target: String,
    },
    /// Execute a maintenance script
    Run {
        script_name: String,
    }
}

pub async fn handle_command(cmd: Commands) -> Result<(), Box<dyn Error>> {
    match cmd {
        Commands::Deploy { target } => {
            let client = DockerClient::new()?;
            client.run_compose("up", &target).await?;
        }
        Commands::Run { script_name } => {
            execute_script(&script_name)?;
        }
    }
    Ok(())
}
