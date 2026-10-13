use std::collections::HashMap;

use axum::extract::{Form, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::counter::Counter;
use crate::auth::{captcha, lockout, password, session};
use crate::config::CaptchaProvider;
use crate::http::{refuse, Refusal};
use crate::store::{
    load_admin_permissions, load_admin_user, touch_last_login, AdminUser, RANKING_READ_PERMISSION,
};
use crate::AppState;

use super::gate::client_address;

/// Refuses when the console cannot count failures or sign a session: both are
/// prerequisites for a login that means anything, and neither has a safe fallback.
pub async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Form(fields): Form<HashMap<String, String>>,
) -> Response {
    let Some(counter) = state.counter() else {
        return refuse("the failure counters are unreachable, so no login is accepted");
    };
    let Some(secret) = state.config().session_secret.clone() else {
        return refuse("no RANKING_SESSION_SECRET is configured");
    };
    let username = field(&fields, "username");
    let password = field(&fields, "password");
    if username.is_empty() || password.is_empty() {
        return Redirect::to("/login?error=empty").into_response();
    }
    let address = client_address(&headers);
    let account_key = lockout::account_key(&username, &address);
    let address_key = lockout::address_key(&address);
    if let Some(response) = enforce_throttle(
        &state,
        counter,
        &fields,
        &account_key,
        &address_key,
        &address,
    )
    .await
    {
        return response;
    }
    match authenticate(&state, &username, &password).await {
        Ok(Some(user)) => accept(&state, counter, &secret, user, &account_key, &address_key).await,
        Ok(None) => {
            record_failure(counter, &account_key, &address_key).await;
            Redirect::to("/login?error=credentials").into_response()
        }
        Err(refusal) => refusal.response(),
    }
}

/// Answers the locked account or address, and the challenge that does not verify.
async fn enforce_throttle(
    state: &AppState,
    counter: &Counter,
    fields: &HashMap<String, String>,
    account_key: &str,
    address_key: &str,
    address: &str,
) -> Option<Response> {
    let (verdict, failures) = match standing(counter, account_key, address_key).await {
        Ok(standing) => standing,
        Err(error) => return Some(refuse(&error)),
    };
    if verdict.locked {
        return Some(locked_response(&verdict));
    }
    if captcha::challenge_required(failures, state.config().captcha.threshold) {
        let active = captcha::select_active(&state.config().captcha, state.counter())
            .await
            .map(|(provider, _)| provider);
        let requested = fields
            .get("captchaProvider")
            .and_then(|name| CaptchaProvider::parse(name))
            .or(active);
        let token = requested
            .map(|provider| captcha_token(fields, provider))
            .unwrap_or_default();
        let verified = captcha::verify(
            &state.config().captcha,
            state.http(),
            &token,
            Some(address),
            requested,
            state.counter(),
        )
        .await;
        if verified.is_err() {
            record_failure(counter, account_key, address_key).await;
            return Some(Redirect::to("/login?error=challenge").into_response());
        }
    }
    None
}

/// The 429 a locked account or address gets, carrying Retry-After when it is known.
fn locked_response(verdict: &lockout::Verdict) -> Response {
    let mut response = refuse("too many failed attempts").into_response();
    *response.status_mut() = StatusCode::TOO_MANY_REQUESTS;
    if let Ok(value) = verdict.retry_after_seconds.to_string().parse() {
        response.headers_mut().insert(header::RETRY_AFTER, value);
    }
    response
}

async fn authenticate(
    state: &AppState,
    username: &str,
    password: &str,
) -> Result<Option<AdminUser>, Refusal> {
    let Some(db) = state.db() else {
        return Err(Refusal("no database is configured".to_string()));
    };
    let user = load_admin_user(db.pool(), username)
        .await
        .map_err(|error| Refusal(error.to_string()))?;
    let Some(user) = user else {
        return Ok(None);
    };
    match password::verify(&user.authentication, password) {
        Ok(true) => {}
        // A malformed stored row is not a wrong password, so it is refused loudly
        // rather than counted against the operator trying to get in.
        Err(error) => return Err(Refusal(error.to_string())),
        Ok(false) => return Ok(None),
    }
    let permissions = load_admin_permissions(db.pool(), user.id)
        .await
        .map_err(|error| Refusal(error.to_string()))?;
    // An admin without the ranking key is refused exactly like a wrong password: the
    // account exists, and saying so would confirm it to a prober.
    if permissions.has_permission(RANKING_READ_PERMISSION) {
        Ok(Some(user))
    } else {
        Ok(None)
    }
}

async fn accept(
    state: &AppState,
    counter: &Counter,
    secret: &str,
    user: AdminUser,
    account_key: &str,
    address_key: &str,
) -> Response {
    let keys = vec![account_key.to_string(), address_key.to_string()];
    let _ = counter.clear(&keys).await;
    if let Some(db) = state.db() {
        let _ = touch_last_login(db.pool(), user.id).await;
    }
    let token = match session::issue(secret, &user.username, now()) {
        Ok(token) => token,
        Err(error) => return refuse(&error.to_string()),
    };
    let mut response = Redirect::to("/").into_response();
    if let Ok(value) = session::set_cookie(&token, false).parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

async fn standing(
    counter: &Counter,
    account_key: &str,
    address_key: &str,
) -> Result<(lockout::Verdict, u32), String> {
    let account = counter
        .read(account_key)
        .await
        .map_err(|error| error.to_string())?;
    let address = counter
        .read(address_key)
        .await
        .map_err(|error| error.to_string())?;
    let count = account
        .as_ref()
        .map(|(count, _)| *count)
        .unwrap_or(0)
        .max(address.as_ref().map(|(count, _)| *count).unwrap_or(0));
    Ok((lockout::verdict(account, address), count))
}

async fn record_failure(counter: &Counter, account_key: &str, address_key: &str) {
    let _ = counter.record_failure(account_key, lockout::WINDOW).await;
    let _ = counter.record_failure(address_key, lockout::WINDOW).await;
}

fn captcha_token(fields: &HashMap<String, String>, provider: CaptchaProvider) -> String {
    let names: [&str; 2] = match provider {
        CaptchaProvider::Turnstile => ["cf-turnstile-response", "captcha"],
        CaptchaProvider::HCaptcha => ["h-captcha-response", "captcha"],
        CaptchaProvider::Recaptcha => ["g-recaptcha-response", "captcha"],
    };
    names
        .iter()
        .find_map(|name| fields.get(*name).cloned())
        .unwrap_or_default()
}

fn field(fields: &HashMap<String, String>, name: &str) -> String {
    fields
        .get(name)
        .map(|value| value.trim())
        .unwrap_or_default()
        .to_string()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}
