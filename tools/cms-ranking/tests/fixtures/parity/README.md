# Ranking parity baseline

The Rust replacement is accepted only if it reproduces what the Python ranking web server
produces for the same seed data. This directory holds that contract.

## Status: two kinds of fixture

**Executed.** The score expectations in `scoring-oracle.json` are the output of the real
`src/cmsranking/Scoring.py`, run by `score_oracle.py` against `seed.json`. That oracle needs no
Docker and no gevent: it installs a minimal `gevent.lock.RLock` substitute, because the scorer
reaches that one symbol transitively and the full stack is not installable everywhere. It is an
execution of the shipping algorithm, so the values it prints are evidence rather than a reading.

It paid for itself on the first run. The hand-derived draft of `seed.json` claimed /history
carried a change to 0.0 for u1/t0; `Score.append_change` only appends when the computed score
differs from the current one, so no such entry exists. The oracle printed the real list.

**Derived, not captured.** Every HTTP fixture — `entities.json`, `endpoints.json`,
`events.json` — was read out of the Python source, because the authoring environment has no
Docker daemon and no `gevent`/`werkzeug`, so the server itself could not be started
(verified 2026-10-09). `capture.sh` produces those recorded responses on a host that has the
service running; run it before Slice 3 and commit its output under `captured/<timestamp>/`.

## Files

| File | Holds |
|---|---|
| `entities.json` | The wire shape of each store entity, from `set()`, `get()` and `validate()` |
| `endpoints.json` | Routes, methods, auth, status codes and response shapes |
| `events.json` | The server-sent event names and framing |
| `seed.json` | Deterministic seed payloads, shared by the oracle and the capture |
| `scoring-oracle.json` | What the real Python scorer produced from `seed.json` |
| `score_oracle.py` | Runs the Python scorer against `seed.json`; no Docker, no gevent stack |
| `capture.sh` | Reproduces the golden HTTP bytes against a running Python service |

## Sources

| Claim | Read from |
|---|---|
| Entity fields and types | `src/cmsranking/{User,Team,Task,Contest,Submission,Subchange}.py` (`set`, `get`, `validate`) |
| Routes and status codes | `src/cmsranking/RankingWebServer.py` (StoreHandler, SubListHandler, HistoryHandler, ScoreHandler, ImageHandler, RootHandler, PublicConfigHandler, CreditsHandler, RoutingHandler) |
| Event framing | `src/cmscommon/eventsource.py` |
| Score and history assembly | `src/cmsranking/Scoring.py` (`Score.get_score`, `ScoringStore.get_global_history`) |
| Public configuration shape | `src/cmsranking/Config.py` (`PublicConfig`) |
| Push payloads | `src/cms/service/ProxyService.py`, `src/cmscontrib/RWSHelper.py` |
