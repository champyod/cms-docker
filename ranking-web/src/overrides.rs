use serde::Serialize;
use sqlx::postgres::PgPool;

use crate::store::StoreError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, sqlx::FromRow)]
pub struct Override {
    pub target_kind: String,
    pub target_key: String,
    pub action: String,
    pub value: Option<String>,
}

pub async fn load_overrides(pool: &PgPool) -> Result<Vec<Override>, StoreError> {
    let rows = sqlx::query_as::<_, Override>(
        "SELECT target_kind, target_key, action, payload->>'value' AS value \
         FROM ranking_overrides WHERE active ORDER BY id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn row(kind: &str, key: &str, action: &str, value: Option<&str>) -> Override {
        Override {
            target_kind: kind.to_string(),
            target_key: key.to_string(),
            action: action.to_string(),
            value: value.map(str::to_string),
        }
    }

    #[test]
    fn later_rows_win_by_position() {
        let rows = vec![
            row("user", "alice", "hide", None),
            row("user", "alice", "rename", Some("Alicia")),
        ];
        let latest: BTreeMap<(String, String), &Override> = rows
            .iter()
            .map(|row| ((row.target_kind.clone(), row.target_key.clone()), row))
            .collect();
        assert_eq!(
            latest.get(&("user".to_string(), "alice".to_string())),
            Some(&&rows[1])
        );
    }

    #[test]
    fn unknown_verbs_survive_the_serve() {
        let kept = serde_json::to_string(&row("user", "bob", "frob", None)).unwrap();
        assert!(kept.contains("\"action\":\"frob\""));
    }
}
