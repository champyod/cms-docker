# Ranking parity baseline

The Rust replacement is accepted only if it reproduces what the Python ranking web server
produces for the same seed data. This directory holds that contract.

## Status: derived, not captured

The fixtures here were **derived by reading the Python source**, because the authoring
environment has no Docker daemon and no `gevent`/`werkzeug`, so the service could not be run
(verified 2026-10-09). Nothing in this directory is a recorded response yet.

`capture.sh` produces the recorded responses on a host that has the service running. Run it
before Slice 3 and commit the output under `captured/<timestamp>/`. Until then, every
`expected_*` field below is a derivation that the capture will confirm or falsify.

## Files

| File | Holds |
|---|---|
| `entities.json` | The wire shape of each store entity, from `set()`, `get()` and `validate()` |
| `endpoints.json` | Routes, methods, auth, status codes and response shapes |
| `events.json` | The server-sent event names and framing |
| `seed.json` | Deterministic seed data plus the values derived from it, keyed by what must match |
| `capture.sh` | Reproduces the golden bytes against a running Python service |

## Sources

| Claim | Read from |
|---|---|
| Entity fields and types | `src/cmsranking/{User,Team,Task,Contest,Submission,Subchange}.py` (`set`, `get`, `validate`) |
| Routes and status codes | `src/cmsranking/RankingWebServer.py` (StoreHandler, SubListHandler, HistoryHandler, ScoreHandler, ImageHandler, RootHandler, PublicConfigHandler, CreditsHandler, RoutingHandler) |
| Event framing | `src/cmscommon/eventsource.py` |
| Score and history assembly | `src/cmsranking/Scoring.py` (`Score.get_score`, `ScoringStore.get_global_history`) |
| Public configuration shape | `src/cmsranking/Config.py` (`PublicConfig`) |
| Push payloads | `src/cms/service/ProxyService.py`, `src/cmscontrib/RWSHelper.py` |
