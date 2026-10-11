# Captured baseline

The real bytes the Python ranking service returned on the production host, taken before the
Rust cutover so the port can be compared against something that actually ran.

| Fact | Value |
| :--- | :--- |
| When | 2026-10-09T11:41:58Z |
| Where | `com-o@como-main`, `http://127.0.0.1:8890` |
| Image | `ghcr.io/champyod/cms-docker-core:major-admin-panel` |
| Commit in the image | `9d6382e497b8b12771ae8bb657ba0d38353d6044` |
| Command | `capture.sh --no-seed --stdout` |

Read-only: `--no-seed` skipped every write, so nothing was seeded into or removed from the
live service. The data in these bodies is the production contest's own.

## What is here

- `config.json`, `scores.json`, `history.json`, `users_list.json` — bodies, verbatim.
- `users_one.status` — `/users/u0` answered **404**, and the body was an HTML 404 page.
- `events.stream` — five seconds of `/events`; the only thing sent was a `:` heartbeat.
- `MANIFEST.txt` — as the script wrote it.

## What is not

- The `/` body: it is the vendored static page, which the repository already holds, so it is
  not duplicated here. Its `LicenseNotice` block already reads `PublicConfig["source_url"]`.
- The `/logo` body: JPEG bytes cannot travel through a pasted text capture.
- The `/credits` body: its shape is recorded in `FINDINGS.md`; the full list is regenerated
  from `credits.json` rather than stored twice.

