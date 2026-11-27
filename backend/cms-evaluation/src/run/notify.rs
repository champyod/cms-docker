//! The outbound `new_evaluation` call to ScoringService.
//!
//! The client is kept by the worker across operations and dropped on a refused
//! call, so the next notification dials again. An absent address is a normal
//! single-service deployment: it logs once per notification and changes no
//! committed row.

use cms_svc::Client;
use serde_json::json;

use crate::service::Evaluation;

const NEW_EVALUATION_METHOD: &str = "new_evaluation";
const SUBMISSION_ID_ARGUMENT: &str = "submission_id";
const DATASET_ID_ARGUMENT: &str = "dataset_id";

/// Notify ScoringService that one submission verdict is ready to score.
///
/// # Errors
///
/// Returns the client's own refusal when a configured address cannot be dialed
/// or the call itself is refused.
pub fn scoring(
    evaluation: &Evaluation,
    client: &mut Option<Client>,
    submission_id: i32,
    dataset_id: i32,
) -> Result<(), String> {
    let Some(address) = evaluation.scoring_address() else {
        eprintln!("cms-evaluation: no scoring service address; skipping notification");
        return Ok(());
    };
    let connection = match client.as_mut() {
        Some(connection) => connection,
        None => client.insert(
            Client::connect(address, evaluation.rpc_secret().map(str::to_owned))
                .map_err(|error| error.to_string())?,
        ),
    };
    let result = connection.call(
        NEW_EVALUATION_METHOD,
        json!({
            SUBMISSION_ID_ARGUMENT: submission_id,
            DATASET_ID_ARGUMENT: dataset_id,
        }),
    );
    if result.is_err() {
        *client = None;
    }
    result.map(|_| ()).map_err(|error| error.to_string())
}
