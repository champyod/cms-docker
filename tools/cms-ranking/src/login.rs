use std::collections::HashMap;

use axum::extract::{Form, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::{captcha, lockout, password, session};
use crate::config::CaptchaProvider;
use crate::http::{refuse, Refusal};
use crate::store::{load_appearance, load_console_user, touch_last_login, ConsoleUser};
use crate::AppState;

#[derive(serde::Deserialize)]
pub struct LoginQuery {
    pub error: Option<String>,
}

pub async fn page(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<LoginQuery>,
) -> Response {
    let captcha = &state.config().captcha;
    let html = page_html(captcha, query.error.as_deref());
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

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
    let (verdict, failures) = match standing(counter, &account_key, &address_key).await {
        Ok(standing) => standing,
        Err(error) => return refuse(&error),
    };
    if verdict.locked {
        let mut response = refuse("too many failed attempts").into_response();
        *response.status_mut() = StatusCode::TOO_MANY_REQUESTS;
        if let Ok(value) = verdict.retry_after_seconds.to_string().parse() {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        return response;
    }
    if captcha::challenge_required(failures, state.config().captcha.threshold) {
        let token = captcha_token(&fields, state.config().captcha.provider);
        let verified = captcha::verify(
            &state.config().captcha,
            state.http(),
            &token,
            Some(&address),
        )
        .await;
        if verified.is_err() {
            record_failure(counter, &account_key, &address_key).await;
            return Redirect::to("/login?error=challenge").into_response();
        }
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

pub async fn logout() -> Response {
    let mut response = Redirect::to("/login").into_response();
    if let Ok(value) = session::clear_cookie().parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// The protected-mode gate. It runs before every route except the three an anonymous
/// caller must reach, and it reads access_mode from the same row /config serves, so a
/// panel change takes effect on the next request rather than on the next deploy.
pub async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    if matches!(path.as_str(), "/healthz" | "/login" | "/logout") {
        return next.run(request).await;
    }
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    let appearance = match load_appearance(db.pool()).await {
        Ok(row) => row,
        Err(error) => return refuse(&error.to_string()),
    };
    let protected = appearance
        .as_ref()
        .is_some_and(|row| row.access_mode == "protected");
    if !protected {
        return next.run(request).await;
    }
    let session =
        session::from_headers(state.config().session_secret.as_deref(), request.headers());
    if session.is_some() {
        return next.run(request).await;
    }
    Redirect::to("/login").into_response()
}

async fn authenticate(
    state: &AppState,
    username: &str,
    password: &str,
) -> Result<Option<ConsoleUser>, Refusal> {
    let Some(db) = state.db() else {
        return Err(Refusal("no database is configured".to_string()));
    };
    let user = load_console_user(db.pool(), username)
        .await
        .map_err(|error| Refusal(error.to_string()))?;
    let Some(user) = user else {
        return Ok(None);
    };
    match password::verify(&user.password, password) {
        Ok(true) => Ok(Some(user)),
        // A malformed stored row is not a wrong password, so it is refused loudly
        // rather than counted against the operator trying to get in.
        Err(error) => Err(Refusal(error.to_string())),
        Ok(false) => Ok(None),
    }
}

async fn accept(
    state: &AppState,
    counter: &crate::auth::counter::Counter,
    secret: &str,
    user: ConsoleUser,
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
    counter: &crate::auth::counter::Counter,
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

async fn record_failure(
    counter: &crate::auth::counter::Counter,
    account_key: &str,
    address_key: &str,
) {
    let _ = counter.record_failure(account_key, lockout::WINDOW).await;
    let _ = counter.record_failure(address_key, lockout::WINDOW).await;
}

fn captcha_token(fields: &HashMap<String, String>, provider: CaptchaProvider) -> String {
    let names: [&str; 2] = match provider {
        CaptchaProvider::Turnstile => ["cf-turnstile-response", "captcha"],
        CaptchaProvider::HCaptcha => ["h-captcha-response", "captcha"],
    };
    names
        .iter()
        .find_map(|name| fields.get(*name).cloned())
        .unwrap_or_default()
}

/// The client address the counters are scoped to. Behind the domain proxy the socket
/// is the proxy, so the forwarded header is the only address that means anything.
pub fn client_address(headers: &HeaderMap) -> String {
    for name in ["x-forwarded-for", "x-real-ip"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            let first = value.split(',').next().unwrap_or_default().trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    "unknown".to_string()
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

fn page_html(captcha: &crate::config::CaptchaConfig, error: Option<&str>) -> String {
    let message = error.map(describe).unwrap_or_default();
    let widget = if captcha.enabled {
        widget_html(captcha)
    } else {
        String::new()
    };
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Ranking console</title></head><body><main><h1>Ranking console</h1>{message}<form method=\"post\" action=\"/login\"><label>Username <input name=\"username\" autocomplete=\"username\" required></label><label>Password <input name=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>{widget}<button type=\"submit\">Sign in</button></form></main></body></html>"
    )
}

fn widget_html(captcha: &crate::config::CaptchaConfig) -> String {
    let key = captcha.site_key.replace('"', "");
    match captcha.provider {
        CaptchaProvider::Turnstile => format!(
            "<div class=\"cf-turnstile\" data-sitekey=\"{key}\"></div><script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\" async defer></script>"
        ),
        CaptchaProvider::HCaptcha => format!(
            "<div class=\"h-captcha\" data-sitekey=\"{key}\"></div><script src=\"https://js.hcaptcha.com/1/api.js\" async defer></script>"
        ),
    }
}

fn describe(code: &str) -> String {
    let text = match code {
        "empty" => "Enter a username and a password.",
        "challenge" => "The challenge was not accepted.",
        "credentials" => "Those credentials were not accepted.",
        _ => "Sign in to continue.",
    };
    format!("<p role=\"alert\">{text}</p>")
}
