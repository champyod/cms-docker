# S-2a — the `cmscommon` core, security-bearing half

Half of S-2 (`../PLAN.md` §3). The other half is S-2b: `mimetypes`, `terminal`, `eventsource`,
`conf_parser`, `archive`. This one is the half where a mistake is a vulnerability, so it lands first
and alone.

## Scope, measured on this lane's base `e418a316`

Of the 48 public names in `src/cmscommon`, only 6 have any Rust mention (`grep` over `backend/**/*.rs`).
This slice takes the ones that touch secrets, passwords and bytes:

| Module | Lines | Public names with no Rust home |
|---|---|---|
| `crypto.py` | 333 | `get_random_key`, `get_hex_random_key`, `encrypt_binary`, `decrypt_binary`, `encrypt_number`, `decrypt_number`, `generate_random_password`, `build_password`, `hash_password` (9 of 11; `parse_authentication` and `validate_password` already exist in Rust) |
| `binary.py` | 41 | `bin_to_hex`, `hex_to_bin`, `bin_to_b64`, `b64_to_bin` (4 of 4) |
| `digest.py` | 75 | `Digester`, `bytes_digest`, `path_digest` (3 of 3) |

`crypto.py` imports `binary.py` and the whole tree reaches `crypto` from **24 files** — the contest
authentication path (`cms/server/contest/authentication.py`), the admin toolbox, the user DB layer
(`cms/db/user.py`), the CLI writers and the test suite. That fan-in, not the line count, is why this
slice is on its own.

## The fork you must NOT decide

`encrypt_binary`/`decrypt_binary` are **AES-256-CBC with a homegrown padding scheme** — a 16-byte
random IV, `\x01` then `\x00`-fill to the block size, URL-safe base64 (`+`→`-`, `/`→`_`, `=`→`.`),
and a decrypt that strips padding with `rstrip(b"\x00")[:-1]` and a `TODO` admitting it never checks
the padding is well formed. `encrypt_number`/`decrypt_number` are the same construction over an int.

The replacement must be **byte-compatible on decrypt**: existing ciphertext lives in the database and in
`config.toml`, so a "better" cipher silently makes every stored secret undecryptable. Choosing a new
construction is therefore not a refactor — it is a migration with a re-encryption path, and it is the
operator's call, not the implementing agent's. **Implement AES-256-CBC byte-compatibly and say so in
the commit.** If you believe the scheme is unsafe enough to warrant replacing it, that is a finding to
report — with the specific weakness and what re-encryption would cost — not a change to make.

## Acceptance criteria

1. `binary.py` and `digest.py` ported in full, with the Python behaviours preserved. For `Digester`,
   name which algorithm it actually is (`md5`/`sha1`/`sha512` — read the file) and prove it against
   the Python implementation's output for the same input.
2. `crypto.py` ported: `get_random_key`, `get_hex_random_key`, `generate_random_password`,
   `encrypt_binary`, `decrypt_binary`, `encrypt_number`, `decrypt_number`, `build_password`,
   `hash_password`.
3. **Cross-language proof, both directions.** A test that encrypts with the Rust implementation and
   decrypts with the Python one, and the reverse, for: empty bytes, 1..16 bytes (the padding
   boundary), exactly one block, and one value larger than a block. Plus an int round trip. The Python
   side is available in this lane at `src/cmscommon/crypto.py`, and in the stack image.
4. `build_password`/`hash_password` stay compatible with the `bcrypt:` / `plaintext:` prefix format
   that `cms/db/user.py` writes and `validate_password` reads — an existing row must still verify.
5. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` all exit 0 in
   `backend/`, and the crate you put this in is named in the handback.

## Where

A new module inside an existing crate if one fits — check `cms-db/src/auth.rs` first, it already owns
`parse_authentication`, `validate_password` and a `BcryptVerifier`, so it may be the right home. Do not
create a sixth workspace member without saying why in the commit; the plan's Q1 (one crate or five) is
still open and this slice should not pre-empt it.

## Out of scope

- Do not edit `admin-panel/**`, `docs/DESIGN*.md`, any other `.worktrees/` lane.
- Do not change the `bcrypt:`/`plaintext:` wire format, the AES construction, or any DB row.
- No new runtime dependency unless the destination crate already needs it; if a crate for AES or
  base64 is genuinely required, propose it in the handback with the alternative you rejected — a new
  dependency is the operator's decision, not yours.

## Report

Per `docs/agent-protocol.md` §1: command, exit code, counts, one line of what it proves — an evidence
table, one row per criterion. Then what landed (SHA), what is blocked (named), what is next.
