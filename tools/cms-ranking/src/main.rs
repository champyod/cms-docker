use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    match cms_ranking::run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("cms-ranking: {error}");
            ExitCode::FAILURE
        }
    }
}
