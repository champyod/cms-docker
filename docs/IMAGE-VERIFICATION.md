# Image signature verification (deploy gate)

Every image this repository ships is signed, keyless, by the workflow that built
it, and the deploy path refuses to pull an image whose signature does not verify.

## What signs

`build-and-push-*` jobs in `.github/workflows/ci.yml`:

- build with `provenance: mode=max` and `sbom: true`, so the registry keeps an
  SLSA provenance attestation and an SPDX SBOM beside each image;
- install cosign (`sigstore/cosign-installer`, pinned to cosign `v2.5.2`);
- run `cosign sign --yes <image>@<digest>` on the digest the build step pushed,
  not on the tag.

Signing is keyless: cosign exchanges the job's GitHub OIDC token
(`id-token: write`) for a short-lived Fulcio certificate and pushes the
signature to GHCR. **There is no signing key in this repository, in its secrets,
or on any host.** Nothing to rotate, nothing to leak.

## What verifies

`scripts/__verify_images.sh`, called from the Makefile's `DEPLOYMENT_TYPE=img`
branch of every stack target (`core`, `admin`, `contest`, `worker`, `infra`).

Why there: `./cms deploy <stack> --img` runs no compose command of its own — the
Rust CLI runs `make <stack>` with `DEPLOYMENT_TYPE_OVERRIDE=img`, and
`./cms update-server` shells the same targets. The Makefile is therefore the one
place every image-pulling deploy passes through, and the gate sits in it, before
`compose pull`. The image list comes from `docker compose ... config --images`,
so the gate checks exactly what that stack is about to pull.

The expected identity defaults to:

    issuer:   https://token.actions.githubusercontent.com
    identity: ^https://github\.com/champyod/cms-docker/\.github/workflows/ci\.yml@refs/heads/(main|major/admin-panel)$

i.e. only a signature made by *this* repository's CI workflow, on one of its two
deploy branches. A signature from another repository, another workflow, or a
fork's copy of this workflow does not pass.

Upstream base images (`postgres`, `redis`, `nginx`, …) are not under
`ghcr.io/champyod/cms-docker-` and are not this repository's to sign; the gate
logs them and moves on.

## When it refuses

The gate exits non-zero with a named reason, before anything is pulled:

| reason              | meaning |
|---------------------|---------|
| `no-signature`      | the image has no cosign signature at all — it predates signing, or the build job never signed it |
| `identity-mismatch` | a signature exists but not from this repository's release workflow (wrong repo, workflow, or branch) |
| `registry-refused`  | the registry would not serve the image or its signature (auth, missing manifest) |
| `cosign-missing`    | cosign is not installed on this host — the gate fails closed rather than skipping |
| `no-images`         | the caller passed no image refs, so nothing could be checked |
| `verify-failed`     | cosign failed for a reason the gate cannot classify |

Run it by hand, without pulling anything:

    make verify-images
    bash scripts/__verify_images.sh ghcr.io/champyod/cms-docker-core:major-admin-panel

## Installing cosign on a deploy host

The gate fails closed when cosign is absent (`reason=cosign-missing`) — an
unchecked image is not a verified one. Install the same release the workflow
signs with, from the operator's own shell:

    curl -fsSL -o cosign \
      https://github.com/sigstore/cosign/releases/download/v2.5.2/cosign-linux-amd64
    sudo install -m 0755 cosign /usr/local/bin/cosign
    cosign version   # expect GitVersion: v2.5.2

## The emergency override

    CMS_SKIP_IMAGE_VERIFY=1 ./cms deploy all --img

This is the **only** way to deploy an image that does not verify, and it exists
for one situation: the registry is intact, the signed build is not available yet,
and standing the deployment up matters more than the check. It is not a dev-loop
convenience — `DEPLOYMENT_TYPE=src` builds locally and needs no signature at all.

While it is set, the gate prints `reason=operator-override` and names what is
unverified. Treat every use as an incident to close: record why the signed image
was unavailable, and re-deploy without the flag once it exists.

## Verifying by hand

    cosign verify ghcr.io/champyod/cms-docker-core@sha256:<digest> \
      --certificate-identity-regexp '^https://github\.com/champyod/cms-docker/\.github/workflows/ci\.yml@refs/heads/(main|major/admin-panel)$' \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com

    cosign verify-attestation --type spdxjson ghcr.io/champyod/cms-docker-core@sha256:<digest>

The first prints the certificate's identity and issuer; the second shows the SBOM
the build attached.
