use axum::extract::{Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};

use crate::auth::captcha;
use crate::config::{CaptchaKeys, CaptchaProvider};
use crate::AppState;

#[derive(serde::Deserialize)]
pub struct LoginQuery {
    pub error: Option<String>,
}

pub async fn page(State(state): State<AppState>, Query(query): Query<LoginQuery>) -> Response {
    let config = &state.config().captcha;
    // WHY health decides the rendered provider: an unreachable primary must
    // offer the next provider in the chain, and this is the render path.
    let active = if config.enabled {
        captcha::select_active(config, state.counter()).await
    } else {
        None
    };
    let html = page_html(active, query.error.as_deref());
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

fn page_html(active: Option<(CaptchaProvider, &CaptchaKeys)>, error: Option<&str>) -> String {
    let message = error.map(describe).unwrap_or_default();
    let widget = active
        .map(|(provider, keys)| widget_html(provider, keys))
        .unwrap_or_default();
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Ranking console</title></head><body><main><h1>Ranking console</h1>{message}<form method=\"post\" action=\"/login\"><label>Username <input name=\"username\" autocomplete=\"username\" required></label><label>Password <input name=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>{widget}<button type=\"submit\">Sign in</button></form></main></body></html>"
    )
}

fn widget_html(provider: CaptchaProvider, keys: &CaptchaKeys) -> String {
    let key = keys.site_key.replace('"', "");
    let widget = match provider {
        CaptchaProvider::Turnstile => format!(
            "<div class=\"cf-turnstile\" data-sitekey=\"{key}\"></div><script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\" async defer></script>"
        ),
        CaptchaProvider::HCaptcha => format!(
            "<div class=\"h-captcha\" data-sitekey=\"{key}\"></div><script src=\"https://js.hcaptcha.com/1/api.js\" async defer></script>"
        ),
        CaptchaProvider::Recaptcha => format!(
            "<div class=\"g-recaptcha\" data-sitekey=\"{key}\"></div><script src=\"https://www.google.com/recaptcha/api.js\" async defer></script>"
        ),
    };
    format!(
        "{widget}<input type=\"hidden\" name=\"captchaProvider\" value=\"{}\">",
        provider.wire_name()
    )
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
