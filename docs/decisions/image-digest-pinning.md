# ADR: Third-party container images are pinned by digest

- **Status:** Accepted — supersedes the "digest pinning is an OPEN DECISION" note that lived in
  `renovate.json`'s packageRules.
- **Date:** 2026-10-25
- **Deciders:** Security feed, Compose/stack ownership
- **Scope:** every `image:` reference in `docker-compose*.yml` and `docker/docker-compose*.yml`,
  and every `FROM`/`ARG BASE_IMAGE` in `Dockerfile`, `docker/*/Dockerfile`

## Context

A tag is a moving pointer. `postgres:15`, `nginx:alpine` and `redis:7-alpine` re-resolve to
whatever the registry serves at pull time, so the stack that was reviewed is not necessarily the
stack that starts, and git records no difference. Two producers in the security feed already
exist to notice drift after the fact — Renovate opens version PRs, Diun compares the running
digest against the registry — but neither of them prevents a first pull of unvetted bits, and
Diun's whole premise ("the image I am running is not the digest the registry now serves")
assumes the reference *has* a digest to compare.

For an intentionally released pin, the reviewable unit is `tag@sha256:<digest>`: the tag keeps
the file human-readable, the digest fixes the bits, and moving either is a diff.

## Decision

1. **Every third-party image carries its readable tag AND an `@sha256:` digest** —
   `image: postgres:15@sha256:baa22e62…`. The tag is never dropped: a bare digest is unreadable
   in review, and the tag is what Renovate compares versions against.
2. **No `:latest`, no untagged third-party reference.** Both mean "whatever the registry has
   now". A reference that arrives untagged is pinned to the concrete release that its floating
   tag resolved to at pin time (see *Untagged references fixed here*), so pinning changes nothing
   that runs today and only stops tomorrow's upstream push from arriving unreviewed.
3. **Pinning is not upgrading.** No tag's version was changed in this pass.
4. **Our own images are exempt, and that is deliberate.**
   `ghcr.io/champyod/cms-docker-*` and `ghcr.io/champyod/cms-security-scan` are built by this
   repo's CI and selected at deploy time by `${IMG_TAG:-major-admin-panel}`.
   WHY no digest on our own images: the tag *is* the deploy selector — a digest would freeze the
   stack to one build and make `IMG_TAG=<sha>` stop working, which is the opposite of what CI
   publishing is for. The repository's own pipeline is the trust boundary here, not a registry
   digest. That phrase is grepped by `tests/test_image_pins.sh`, so it is a load-bearing comment:
   every compose file that declares one of our images must carry it.
5. **An image that cannot be resolved is not declared.** `opencrypto/softhsm` (the `hsm` profile)
   named a repository that does not exist in any registry — `docker pull` answers "pull access
   denied … repository does not exist" — so there was no digest to resolve, and an untagged name
   nobody publishes is an image-squatting target: whoever registers it runs their code with
   `HSM_PIN` in the environment and the token volume mounted. The service was removed rather than
   exempted. The operator-facing HSM flow (`./cms domain setup`, certbot `--hsm`, SoftHSM token
   dir, YubiHSM USB passthrough) is unchanged and still documented in `docs/optional-features.md`
   and `config.toml.example [infra] HSM_*`; a hardware HSM image is pinned by this same policy.
6. **Dockerfiles follow the same rule.** `FROM rust:…`, `node:…`, `alpine:…`, the trivy and
   osv-scanner stages, and the `ARG BASE_IMAGE` default all carry tag+digest. `FROM ${BASE_IMAGE}`
   stays a variable so an operator can still choose `ubuntu:noble` or `debian:bookworm`; the ARG
   *default* is pinned, and an override must carry its own digest. That matches the policy already
   stated at the top of `Dockerfile` ("never apt-upgraded in-build; drift is handled by bumping the
   pinned base digest") — this ADR is what makes it true.

## Where the pin policy lives, and what enforces it

- **This file** is the one place the decision and its exceptions are written down.
- **The compose/Dockerfiles** carry the literals, because that is what `docker compose` and
  `docker build` read; duplicating them into a variable file would put the pin out of Renovate's
  reach.
- **`tests/test_image_pins.sh`** is the gate (`make test` globs `tests/test_*.sh`, so it runs
  there and in CI): a third-party line must carry `@sha256:`, the digest must be 64 lowercase hex
  characters, `:latest`/untagged is rejected, the same `repo:tag` must carry the same digest
  everywhere, and our own `${IMG_TAG}` images must be tagged *and* carry the sentence from rule 4.
  `bash tests/test_image_pins.sh --list` prints the inventory table below from the tree, so the
  table is regenerated, never hand-maintained.
- **`renovate.json`** enables `pinDigests` for the `dockerfile` and `docker-compose` managers, so
  Renovate re-resolves a digest when it bumps a tag and opens a digest-only PR when the tag stands
  still but the registry serves new bits. It also disables itself for `ghcr.io/champyod/*`, per
  rule 4 — otherwise it would keep proposing the pin this decision forbids.

## How a digest is resolved (do not invent one)

```bash
docker buildx imagetools inspect postgres:15 | awk '/^Digest:/{print $2}'
# or, for a manifest list without buildx:
docker manifest inspect -v postgres:15 | jq -r '.[0].Descriptor.digest // .Descriptor.digest'
```

The digest written into the file must be the one the registry reports for that exact tag, and it
should be confirmed with a real pull of the pinned reference. Everything in the table below was
resolved that way on 2026-10-25.

## Untagged references fixed here

| reference before | pinned to | why that tag |
|---|---|---|
| `tailscale/tailscale:latest` | `v1.104.2` | `:latest`, `:stable` and `v1.104.2` all resolved to the same manifest digest, so the newest stable release is what was running |
| `certbot/certbot` (untagged) | `v5.8.0` | `:latest` resolved to `v5.8.0` (identical digest) |
| `tecnativa/docker-socket-proxy` (untagged) | `v0.5.0` | `:latest` resolved to `v0.5.0` (identical digest) |
| `opencrypto/softhsm` (untagged) | *removed* | no registry publishes it — see rule 5 |

## Pins in force

Generated with `bash tests/test_image_pins.sh --list`:

| image:tag | digest |
|---|---|
| `certbot/certbot:v5.8.0` | `sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20` |
| `crazymax/diun:4.33.1` | `sha256:8cc638b4c54e8a0c47898a51b20dae73037ad43310168b5da543a311dc668f77` |
| `ghcr.io/renovatebot/renovate:44.181.3` | `sha256:00f4f69be3060d6ad1ff3481a0e44490aba37ab17c501cbf2de179bc3751dc78` |
| `grafana/grafana:11.2.2` | `sha256:d5133220d770aba5cb655147b619fa8770b90f41d8489a821d33b1cd34d16f89` |
| `hashicorp/vault:1.15` | `sha256:0450896c43b13879b19442b204ce29dd19b5a10fce43d5cf38af17da20f56f4d` |
| `nginx:alpine` | `sha256:a3554c0d0b48177b1413c26e01f695334428020d9df01243fbae3e11cfd17417` |
| `owasp/modsecurity-crs:nginx-alpine` | `sha256:873ce68a658d2e3b61484a8a24d215f7d15456e7ce5aec5e7114bf000d743365` |
| `postgres:15` | `sha256:baa22e6286bf832cb147b8bb5aa9d8bc999846d69c21d11bf63f58fbeed1fa48` |
| `prom/node-exporter:v1.8.2` | `sha256:4032c6d5bfd752342c3e631c2f1de93ba6b86c41db6b167b9a35372c139e7706` |
| `prom/prometheus:v2.52.0` | `sha256:5c435642ca4d8427ca26f4901c11114023004709037880cd7860d5b7176aa731` |
| `redis:7-alpine` | `sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541` |
| `tailscale/tailscale:v1.104.2` | `sha256:b11583ad2e93e4671128538c88cf11f460444a5d7e449311dd1933a400ab849d` |
| `tecnativa/docker-socket-proxy:v0.5.0` | `sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459` |

Dockerfile bases (not compose, so outside the gate's scan):

| image:tag | digest |
|---|---|
| `ubuntu:noble` (`ARG BASE_IMAGE` default) | `sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac` |
| `rust:1-bookworm` | `sha256:48b7f435b8fc6378ce43b44f15e3a47fd8919b2825f835c39bd4bd3da50af5b8` |
| `node:20-bookworm-slim` | `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0` |
| `alpine:3.22` | `sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f` |
| `ghcr.io/aquasecurity/trivy:0.76.1` | `sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c` |
| `ghcr.io/google/osv-scanner:v2.7.0` | `sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0` |

## Consequences

- **A pin freezes the image until Renovate moves it.** That is the point, but it means a
  security fix in a base image arrives only through a Renovate PR (or a manual bump), never
  through a re-pull. The `compose base images` / `docker base images` groups keep that review to
  one PR per week per class.
- **Multi-arch references pin the manifest list.** The digest above is the index digest, so the
  arm64 and amd64 children stay in step; a per-arch digest would break the other platform.
- **Overrides are the operator's to pin.** `ACME_CERTBOT_IMAGE`, `BASE_IMAGE` and a hardware-HSM
  image can be replaced from config, but the replacement must carry tag+digest — the gate only
  guards what the repository ships, so an unpinned override reintroduces exactly the float this
  ADR removes.
- **`opencrypto/softhsm` removal is a functional change**, recorded here on purpose: the `hsm`
  profile can no longer be started. It could not be started before either (the image never
  existed), and the alternative — leaving an unpinnable, squattable name in a security overlay —
  was worse than removing a profile that was dead on arrival.
