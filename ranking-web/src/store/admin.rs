use std::collections::BTreeSet;

use sqlx::postgres::PgPool;

use super::StoreError;

/// The permission that opens the ranking console, the same key the panel's ranking
/// pages demand.
pub const RANKING_READ_PERMISSION: &str = "ranking:read";

const ALL_PERMISSION: &str = "all:all";
const OVERRIDE_EFFECT_ALLOW: &str = "allow";
const OVERRIDE_EFFECT_DENY: &str = "deny";

/// One admin account the console authenticates. The password is verified by the auth
/// module, not here, so this stays a row and nothing more.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AdminUser {
    pub id: i32,
    pub username: String,
    pub authentication: String,
}

/// The permission keys an admin holds, split so a deny can win over the wildcard.
#[derive(Debug, Default)]
pub struct AdminPermissions {
    granted: BTreeSet<String>,
    denied: BTreeSet<String>,
}

impl AdminPermissions {
    /// Folds one (key, effect) row per group grant or override. A group grant is an
    /// implicit 'allow'; only the overrides carry a 'deny'.
    fn fold(rows: impl IntoIterator<Item = (String, String)>) -> Self {
        let mut permissions = Self::default();
        for (key, effect) in rows {
            if effect == OVERRIDE_EFFECT_DENY {
                permissions.denied.insert(key);
            } else {
                permissions.granted.insert(key);
            }
        }
        permissions
    }

    /// Mirrors the panel resolver: group grants and 'allow' overrides grant a key, a
    /// 'deny' is removed last and beats the wildcard it collides with.
    pub fn has_permission(&self, key: &str) -> bool {
        if self.denied.contains(key) {
            return false;
        }
        self.granted.contains(key)
            || (self.granted.contains(ALL_PERMISSION) && !self.denied.contains(ALL_PERMISSION))
    }
}

/// Only an enabled account is returned: a disabled row must read as no account, not
/// as an account whose password happens to fail.
pub async fn load_admin_user(
    pool: &PgPool,
    username: &str,
) -> Result<Option<AdminUser>, StoreError> {
    let row = sqlx::query_as::<_, AdminUser>(
        "SELECT id, username, authentication FROM admins WHERE username = $1 AND enabled",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// The admin's group grants and override rows in one query, unioned; `fold` applies the
/// deny-last rule and the wildcard.
pub async fn load_admin_permissions(
    pool: &PgPool,
    admin_id: i32,
) -> Result<AdminPermissions, StoreError> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT p.key, $2::varchar FROM admin_groups ag \
         JOIN group_permissions gp ON gp.group_id = ag.group_id \
         JOIN permissions p ON p.id = gp.permission_id WHERE ag.admin_id = $1 \
         UNION SELECT p.key, o.effect FROM admin_permission_overrides o \
         JOIN permissions p ON p.id = o.permission_id WHERE o.admin_id = $1",
    )
    .bind(admin_id)
    .bind(OVERRIDE_EFFECT_ALLOW)
    .fetch_all(pool)
    .await?;
    Ok(AdminPermissions::fold(rows))
}

pub async fn touch_last_login(pool: &PgPool, admin_id: i32) -> Result<(), StoreError> {
    sqlx::query("UPDATE admins SET last_login_at = now() WHERE id = $1")
        .bind(admin_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permissions(rows: &[(&str, &str)]) -> AdminPermissions {
        AdminPermissions::fold(
            rows.iter()
                .map(|(key, effect)| (key.to_string(), effect.to_string())),
        )
    }

    #[test]
    fn a_group_grant_holds_the_key() {
        let held = permissions(&[(RANKING_READ_PERMISSION, OVERRIDE_EFFECT_ALLOW)]);
        assert!(held.has_permission(RANKING_READ_PERMISSION));
    }

    #[test]
    fn an_unrelated_grant_does_not_hold_the_key() {
        let held = permissions(&[("ranking:list", OVERRIDE_EFFECT_ALLOW)]);
        assert!(!held.has_permission(RANKING_READ_PERMISSION));
    }

    #[test]
    fn a_deny_override_removes_a_group_grant() {
        let held = permissions(&[
            (RANKING_READ_PERMISSION, OVERRIDE_EFFECT_ALLOW),
            (RANKING_READ_PERMISSION, OVERRIDE_EFFECT_DENY),
        ]);
        assert!(!held.has_permission(RANKING_READ_PERMISSION));
    }

    #[test]
    fn a_lone_wildcard_holds_every_key() {
        let held = permissions(&[(ALL_PERMISSION, OVERRIDE_EFFECT_ALLOW)]);
        assert!(held.has_permission(RANKING_READ_PERMISSION));
    }

    #[test]
    fn a_deny_beats_the_wildcard_it_collides_with() {
        let held = permissions(&[
            (ALL_PERMISSION, OVERRIDE_EFFECT_ALLOW),
            (RANKING_READ_PERMISSION, OVERRIDE_EFFECT_DENY),
        ]);
        assert!(!held.has_permission(RANKING_READ_PERMISSION));
    }

    #[test]
    fn a_denied_wildcard_leaves_only_explicit_grants() {
        let held = permissions(&[
            (ALL_PERMISSION, OVERRIDE_EFFECT_DENY),
            ("other:read", OVERRIDE_EFFECT_ALLOW),
        ]);
        assert!(!held.has_permission(RANKING_READ_PERMISSION));
    }

    #[test]
    fn no_permissions_hold_nothing() {
        assert!(!AdminPermissions::default().has_permission(RANKING_READ_PERMISSION));
    }
}
