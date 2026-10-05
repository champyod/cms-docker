# Admin login CAPTCHA — and where the per-IP ban actually applies

The admin panel login form can sit behind a CAPTCHA (a puzzle that proves the request
came from a person, not an automated script). The challenge is adaptive: nothing appears
until someone has already failed a few times. Failed logins are counted per account and,
on some deployment paths, per source address, and the account is locked for 15 minutes
once the count reaches 5.

The per-source counter is the part that decides how much of a distributed brute force the
layer actually stops, and whether it counts depends on how visitors reach the panel. Read
[Which deployments get per-IP protection](#4-which-deployments-get-per-ip-protection)
before relying on it.

---

## 1. How it works

The panel supports two providers, chosen by `CAPTCHA_PROVIDER`:

- **Turnstile** (Cloudflare) — the default.
- **hCaptcha**.

The challenge is not shown on the first attempts. Two thresholds decide when it appears
and when the account stops accepting logins at all:

| Threshold | Default | Effect |
|---|---|---|
| `CAPTCHA_THRESHOLD` | `3` | Failed logins from one key before the form starts demanding a solved challenge. |
| Lockout | `5` (`MAX_LOGIN_ATTEMPTS`) | Failed logins before the key is refused entirely. The lockout window is a hardcoded 15 minutes (`LOGIN_LOCKOUT_MS` in `admin-panel/src/lib/auth-rate-limit.ts`), not a config value. |

Both counters are held in memory by the panel process, so a restart clears them.

Only the site key is public: it travels to the browser so the widget can render. The secret
key stays server-side and is used to ask the provider whether a token is genuine.

### Two counters per failed attempt

For every failed login the panel records two keys:

- `username|address` — one counter per account and source.
- `ip#<address>` — one counter per source address, shared across usernames.

The second counter exists because an attacker who rotates usernames would otherwise get a
fresh counter each time. The two families live in the same map; the `ip#` prefix is chosen
so a source bucket can never be mistaken for an account bucket.

---

## 2. Configuration

All six settings live in the `[admin]` section of `config.toml`. `config.toml` is the
single source of truth; `./cms config sync` writes them into the generated `.env` file.

| Setting | Default | Meaning |
|---|---|---|
| `CAPTCHA_ENABLED` | `0` | `1` or `true` turns the layer on. With `0` the panel treats the challenge as not configured, whatever the other keys hold. |
| `CAPTCHA_PROVIDER` | `turnstile` | `turnstile` or `hcaptcha`. |
| `CAPTCHA_SITE_KEY` | empty | Public key from the provider dashboard. Also needed server-side so the challenge can be validated. |
| `CAPTCHA_SECRET_KEY` | empty | Server-side key from the provider dashboard. Never generated locally. |
| `CAPTCHA_THRESHOLD` | `3` | Failed logins before the challenge is required. |
| `CAPTCHA_BAN_THRESHOLD` | `5` | Declared ban threshold; the effective lockout is the hardcoded `MAX_LOGIN_ATTEMPTS = 5`. |

Two things to know about the secret:

- It is issued by the provider dashboard, so `./cms config sync` deliberately leaves it
  empty rather than filling in random text — a random value would pass every "is it set"
  test and fail every verification call.
- `scripts/__preflight.sh` (`check_captcha`) fails the check when CAPTCHA is enabled and a
  key is empty, and when the secret looks like a 64-character hex placeholder. It runs only
  for the admin stack (`--stack admin` or `--stack all`) and exits `2` on any hard failure,
  so check it before bringing the stack up.

### Where the values enter the container

The six variables are passed into the `admin-panel-next` container by `docker-compose.yml`
and `docker-compose.admin.yml`. Those two files are the only place the values reach the
container, so if the settings ever move, both files must move with them.

---

## 3. What the panel considers your address

The panel derives the identity used for rate limiting from the first entry of the
`X-Forwarded-For` request header (`admin-panel/src/app/actions/auth.ts`). When that header
is absent it falls back to the literal string `local`.

`isLoopbackIp` in the same file skips the per-IP counter when the resolved address is
loopback — `127.x`, `::1`, the dual-stack form `::ffff:127.x`, or the `local` fallback.
The reason is that a loopback address is shared by every user on that path: a per-address
counter there would be one counter shared by everyone, and one person's mistakes would lock
out unrelated accounts.

Whether that skip applies is decided by the deployment, not by the panel.

---

## 4. Which deployments get per-IP protection

| Deployment | Address the panel sees | Per-IP ban | Lockout key |
|---|---|---|---|
| Domain + nginx (`ADMIN_DOMAIN` vhost) | the real client address | effective | username + IP |
| Tailscale Funnel | `127.0.0.1` for every visitor | skipped | username only |
| Tailscale Serve (direct to panel port) | `local` for every visitor | skipped | username only |
| Direct/local browser access | `local` | skipped | username only |

### Why Funnel and Serve behave this way

Tailscale's `--https` reverse proxy does not put the client address into any request
header, so the real source address is simply not recoverable at the panel on those paths.
The PROXY protocol option (`--proxy-protocol`) does carry the source address, but it
applies to TCP forwarding targets (`--tcp` and `--tls-terminated-tcp`), not to the
`--https` reverse proxy — the mode both Funnel and Serve register.

### What protects Funnel instead

On Funnel the layer in front of the login form is HTTP basic authentication
(`auth_basic` with `auth_basic_user_file`), declared for the Funnel gateways in
`scripts/__nginx-proxy-render.sh`. A visitor has to clear it before the login form is
reachable at all. So on Funnel the CAPTCHA and lockout act **per account, not per source**
— they slow credential guessing against one account and say nothing about how many
different sources are trying.

`config/funnel-mirror.nginx.conf.template` carries the same gateway shape for setups that
render that template, but the running Funnel config is the one
`scripts/__nginx-proxy-render.sh` emits.

### Making the per-IP ban meaningful

The ban only bites when the panel is reached through a proxy that asserts the client
address, and that proxy must overwrite the header rather than append to it — an appended
chain keeps whatever the client sent in front of the real address, letting a client pick
its own bucket.

Both entry points do this for the admin panel:

- `config/grader.nginx.conf.template` — the domain + certbot deployment.
- `scripts/__nginx-proxy-render.sh` — the Funnel gateway on port 8892.

---

## 5. Turning it on

1. Get a site key and secret key from the provider dashboard (Turnstile or hCaptcha).
2. Put them in `config.toml` under `[admin]`:

   ```toml
   [admin]
   CAPTCHA_ENABLED = 1
   CAPTCHA_PROVIDER = "turnstile"
   CAPTCHA_SITE_KEY = "<public key from the dashboard>"
   CAPTCHA_SECRET_KEY = "<secret from the dashboard>"
   CAPTCHA_THRESHOLD = 3
   CAPTCHA_BAN_THRESHOLD = 5
   ```

3. Regenerate the environment and run the checks:

   ```bash
   ./cms config sync
   ```

4. Restart the admin stack so the container picks up the new values:

   ```bash
   ./cms deploy admin --img
   ```

---

## 6. Troubleshooting

**Preflight fails with "CAPTCHA_SITE_KEY empty" or "CAPTCHA_SECRET_KEY empty"** — the
challenge is enabled but a key was never pasted in. Either fill both keys in
`config.toml` or set `CAPTCHA_ENABLED = 0`.

**Preflight fails with "64-char hex placeholder"** — the secret looks generated rather than
issued. Copy the real secret from the provider dashboard.

**The challenge never appears, however many attempts fail** — the panel treats the feature
as unconfigured. `isCaptchaConfigured` requires `CAPTCHA_ENABLED` plus both keys to be
non-empty, so a missing key disables the challenge silently at runtime. `./cms config sync`
already runs preflight and prints the result; `./cms doctor` runs it again on demand, for
every stack unless you narrow it with `--stack admin`.

**Every login says "Too many attempts. Try again later."** — the lockout is keyed on
`username|local` or `username|127.0.0.1`, so five failures against one account from any
visitor on that path locks that account for everyone. That symptom means the panel is
being reached over a loopback path; find the matching row in
[Which deployments get per-IP protection](#4-which-deployments-get-per-ip-protection) and
change the deployment if a per-source ban is wanted.

**Rotating usernames does not reset the counter** — expected where the per-IP counter is
active; the `ip#<address>` bucket still holds. Where the per-IP counter is skipped, rotating
usernames does reset the counter, which is the same property explained in section 4.