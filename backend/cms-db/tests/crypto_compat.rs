//! Ciphertext the Python implementation wrote, opened here — and what this port
//! writes, opened by the Python implementation.
//!
//! The vectors are `cmscommon.crypto.encrypt_binary` at Cryptodome 3.23.0, run
//! in `ghcr.io/champyod/cms-docker-core:major-admin-panel` over this lane's own
//! `src/`, under the key `"00" * 16` and with a fresh IV each time (which is why
//! the ciphertext cannot be recomputed here — only read back). The plaintext of
//! each is `i % 251` for every index `0..len`, so the length ladder is visible
//! in the vector itself: `0`, `1`..`16` either side of the padding boundary,
//! `16` as exactly one block, and `17`, `31`, `32`, `33`, `100` past it.
//!
//! The reverse direction is proved inside `src/crypto.rs`: `seal` takes its IV
//! as an argument, and against an IV the Python side was pinned to it
//! reproduces the Python ciphertext byte for byte — the same bytes therefore
//! decrypt on the Python side, since decryption is a function of the bytes.

use cms_db::{
    build_password, decrypt_binary, decrypt_number, encrypt_binary, encrypt_number,
    generate_random_password, get_hex_random_key, get_random_key, hash_password, Bcrypt,
    CryptoError, PasswordForm, BCRYPT_MAX_PASSWORD_BYTES, BCRYPT_ROUNDS, BLOCK_BYTES, KEY_BYTES,
    PASSWORD_LETTERS,
};

/// The key every captured vector was made under.
const KEY: &str = "00000000000000000000000000000000";

/// A different key of the right size, for proving the second one is needed.
const OTHER_KEY: &str = "11111111111111111111111111111111";

/// `(plaintext length, ciphertext)` written by the Python implementation.
const PYTHON_CIPHERTEXT: &[(usize, &str)] = &[
    (0, "QY6SrGyuY0C0fYFRgCD4FWXF4dhWf11q14sqJDbkpSI."),
    (1, "zR85T9xOva1yphNj_2uO6p7ZAn8KNCjgjajQP5L_yd0."),
    (2, "kVX2Twc30fJ6FkwYE9Yv84hzv3EZLg0OBaBlGPJYTWk."),
    (3, "phGg1iW4lD_px9CR7Q4DuTL-RELOjo4lSN4SnToyJZs."),
    (4, "-EDJDG_kkW9ntp1vQDCUikDZKx9KIqyPoJqe77mUqlY."),
    (5, "ik5TERBZqk1yv9u5xXG-igUYFXUp8Wg5ZRwcwK_omDU."),
    (6, "YpQ9GIMBzc1olfGp_vr4572yTzhND-0MDwGmuo_6XOI."),
    (7, "u0NLOwErgZMIq0AVIWizdTmuq98elJcruX47RJFb_F0."),
    (8, "V3Mp28BMaDFg0xEd9piYUqr0dw5e2U9GvOtP9acYEVA."),
    (9, "z4juyFltaeY3E-xqssO6RzGJGfo5-yK7oFDVvhY7K2k."),
    (10, "CrGe22-kaTa4x0vDx9ARzlhTqaFmDvYnOShHGbiwXVE."),
    (11, "oRqCV2Fc9_lnNnEN7AmerezYQXIVsz46P3m3UtqtocA."),
    (12, "Z5aI9MiAPHxAhGwWzDx2ylTduZ3dCm1yO4UnZgk7F-A."),
    (13, "7NG3rq6rA-uJNPQ_Z-qHEI5blu-Wltno1GT432-5b2o."),
    (14, "kWurSuQZaM04ykK6LOyvFdHXhvq2SxMm7kSg8dhlI80."),
    (15, "_pMzXKmMk1E8nBkUP6Ma7FYFSHiZotUCqOumA9iRfqPr1sct0Vh0IGOaK0PZ3uw2"),
    (16, "rkNIYdO7HrJmcLjVNYhJiGm1bVVbIucc7MMpLMn_slnaohiugHtX14oxKkH9A38q"),
    (17, "ZE-AslFFmxbruIt6B_Lyn0h4e-bVEQLbBZIworN8cav8KbJdGrGx2h08vUJBOiDN"),
    (31, "FAvEN9JkGeKhaTE7YclSBjZiyKj5JleTPw8GJLOcBNoqOx7LNNtDfOyc6jPHdRpOzHQaR9Lktwt-XI-zxcdSRg.."),
    (32, "NoFi79vQidhnOxLSEVCpSdmjWzeuuVKzeWS1msSNlTHMuG3epmDfXCExzpEaGmBRbMPYP-IuIdAMbkPmPofi8A.."),
    (33, "QUvemzUnrO7iagttE7QzI9zRO0Ml0QnR0qNQmZ1UI4FH5NiqGgTcIpXatIthRFGNVi7vFYuRcyssCzPMLjuMXg.."),
    (100, "tFGpefKsIxCUmzVxPdS0_tIk8ckWl_XOorrL89hM4-QIXjpz1dzm29bRz6IQI2kGwvP048OUXFs7qQGc2XlWgotnn_lEmQNsFRURD5nUYF8ZOcUz6nhRtpxQBiAhaTBZO8GHW6QkPpabphafgWzQuFAqE5YSn5awVw6c5zP3Tn0."),
];

/// A `bcrypt:` row exactly as `cms/db/user.py` writes it, from
/// `cmscommon.crypto.hash_password("hunter2")` on the Python side.
const PYTHON_ROW: &str = "bcrypt:$2b$12$JKV0uQIXmn97V6DaGRutNOCSqq8sEvp7gLQJ5pvpPpNMPHcVa7JOK";

/// `(decimal value, ciphertext)` written by `cmscommon.crypto.encrypt_number`.
const PYTHON_NUMBERS: &[(i64, &str)] = &[
    (0, "7a7KiqToP1Cq5BCHziQIAVnR9Lh35h19-fRRkn35gjo."),
    (123, "U-1lbO3NldLJi4HFZwhKvoNLV3SW3f28YC81x_rms-Q."),
    (-123, "0qhl9VdTOFSmewgtNfmEkOk3uAJTAFqju0XRM9fx2Sc."),
];

/// The plaintext each vector was made from: `i % 251` for each index.
fn plaintext(len: usize) -> Vec<u8> {
    (0..len).map(|index| (index % 251) as u8).collect()
}

#[test]
fn every_python_ciphertext_opens_to_the_bytes_it_was_made_from() {
    for (len, ciphertext) in PYTHON_CIPHERTEXT {
        let opened = decrypt_binary(ciphertext, KEY).expect("a captured vector must open");
        assert_eq!(opened, plaintext(*len), "decrypting {len} bytes");
    }
}

#[test]
fn the_padding_boundary_in_both_directions_round_trips() {
    for len in 0..=BLOCK_BYTES {
        let value = plaintext(len);
        let made = encrypt_binary(&value, KEY).expect("a 32-character key encrypts");
        assert_eq!(
            decrypt_binary(&made, KEY).expect("what was just encrypted decrypts"),
            value,
            "round-tripping {len} bytes"
        );
    }
}

#[test]
fn a_plaintext_past_one_block_round_trips() {
    for len in [BLOCK_BYTES + 1, 31, 32, 33, 100, 1000, 100_000] {
        let value = plaintext(len);
        let made = encrypt_binary(&value, KEY).expect("a 32-character key encrypts");
        assert_eq!(decrypt_binary(&made, KEY).expect("it decrypts"), value);
    }
}

#[test]
fn the_same_plaintext_never_encrypts_to_the_same_ciphertext() {
    let first = encrypt_binary(b"stuff", KEY).expect("it encrypts");
    let second = encrypt_binary(b"stuff", KEY).expect("it encrypts");
    assert_ne!(first, second, "each encryption draws its own IV");
}

#[test]
fn a_python_number_ciphertext_decrypts_to_its_number() {
    for (number, ciphertext) in PYTHON_NUMBERS {
        assert_eq!(
            decrypt_number(ciphertext, KEY).expect("a captured number must open"),
            *number
        );
    }
}

#[test]
fn a_number_round_trips_on_the_python_encoding() {
    for number in [0i64, 1, 123, -123, 2_147_483_647, i64::MAX, i64::MIN] {
        let made = encrypt_number(number, KEY).expect("a 32-character key encrypts");
        assert_eq!(
            decrypt_number(&made, KEY).expect("it decrypts"),
            number,
            "round-tripping {number}"
        );
    }
    // `b"%x" % num` and Rust's `{:x}` agree on the sign and the lowercase digits.
    let made = encrypt_number(-123, KEY).expect("it encrypts");
    assert_eq!(
        decrypt_binary(&made, KEY).expect("it opens"),
        b"-7b".to_vec()
    );
}

#[test]
fn the_wrong_key_answers_bytes_rather_than_a_refusal() {
    // Not an assertion about strength but about parity: Python's strip checks
    // nothing, so a wrong key is silent there and has to be silent here.
    let made = encrypt_binary(b"a secret of some length", KEY).expect("it encrypts");
    let wrong = decrypt_binary(&made, OTHER_KEY).expect("the decode itself succeeds");
    assert_ne!(wrong, b"a secret of some length");
}

#[test]
fn a_truncated_or_foreign_ciphertext_is_refused() {
    // These three are the Python unit suite's own cases
    // (`cmstestsuite/unit_tests/cmscommon/crypto_test.py:85-94`).
    let made = encrypt_binary(b"stuff", KEY).expect("it encrypts");
    assert_eq!(decrypt_binary(&made[1..], KEY), Err(CryptoError::NotBase64));
    assert_eq!(
        decrypt_binary("c3R1ZmY=", KEY),
        Err(CryptoError::CryptogramLength { found: 5 })
    );
    assert_eq!(
        decrypt_binary("", KEY),
        Err(CryptoError::CryptogramLength { found: 0 })
    );
}

#[test]
fn a_body_that_is_not_whole_blocks_is_refused() {
    let mut raw = vec![0u8; BLOCK_BYTES];
    raw.extend_from_slice(&[0u8; 15]);
    let text = cms_db::bin_to_b64(&raw)
        .replace('+', "-")
        .replace('/', "_")
        .replace('=', ".");
    assert_eq!(
        decrypt_binary(&text, KEY),
        Err(CryptoError::CryptogramLength { found: 31 })
    );
}

#[test]
fn an_iv_with_no_body_opens_to_nothing() {
    // Python builds the cipher over `iv_ct[:16]` and hands an empty body to
    // `decrypt`, which answers empty rather than refusing.
    let iv_only = "AQIDBAUGBwgJCgsMDQ4PEA..";
    assert_eq!(
        decrypt_binary(iv_only, KEY).expect("an IV alone opens"),
        Vec::<u8>::new()
    );
}

#[test]
fn a_key_that_is_not_thirty_two_hexadecimal_characters_is_refused() {
    assert_eq!(
        encrypt_binary(b"x", "00"),
        Err(CryptoError::KeyLength { found: 2 })
    );
    assert_eq!(
        decrypt_binary("AAAA", "zz000000000000000000000000000000"),
        Err(CryptoError::KeyNotHex { found: 'z' })
    );
}

#[test]
fn a_generated_key_is_sixteen_bytes_and_never_the_same_twice() {
    let first = get_random_key();
    let second = get_random_key();
    assert_eq!(first.len(), KEY_BYTES);
    assert_ne!(first, second);

    let hex = get_hex_random_key();
    assert_eq!(hex.len(), KEY_BYTES * 2);
    assert!(hex
        .chars()
        .all(|digit| digit.is_ascii_hexdigit() && !digit.is_ascii_uppercase()));
}

#[test]
fn a_generated_password_is_six_lowercase_letters_and_never_the_same_twice() {
    let first = generate_random_password();
    let second = generate_random_password();
    assert_eq!(first.len(), PASSWORD_LETTERS);
    assert!(first.chars().all(|letter| letter.is_ascii_lowercase()));
    assert_ne!(first, second);
}

#[test]
fn an_existing_stored_row_still_verifies() {
    // The row is the Python side's, the hash inside it is Python's bcrypt, and
    // the check is this crate's: nothing was re-derived to make it pass.
    let form = PasswordForm::parse(PYTHON_ROW).expect("a stored row parses");
    let hash = form.bcrypt().expect("the row is a bcrypt row");
    assert!(hash.matches("hunter2", &Bcrypt));
    assert!(!hash.matches("hunter3", &Bcrypt));
    assert!(!hash.matches("", &Bcrypt));
}

#[test]
fn a_hash_written_here_is_tagged_the_way_the_column_expects() {
    let row = hash_password("correct horse battery staple", "bcrypt").expect("it hashes");
    let (method, payload) = row.split_once(':').expect("the row carries its method");
    assert_eq!(method, "bcrypt");
    assert_eq!(payload.len(), 60, "a bcrypt payload is 60 characters");
    assert!(
        payload.starts_with("$2b$12$"),
        "the cost is {BCRYPT_ROUNDS}"
    );
    assert_eq!(build_password(payload, "bcrypt").expect("it tags"), row);

    let form = PasswordForm::parse(&row).expect("a written row parses");
    let hash = form.bcrypt().expect("the row is a bcrypt row");
    assert!(hash.matches("correct horse battery staple", &Bcrypt));
    assert!(!hash.matches("correct horse battery stapl", &Bcrypt));
}

#[test]
fn a_plaintext_row_parses_to_a_payload_no_bcrypt_check_can_use() {
    // The refusal of the method itself lives in `validate_password`
    // (`crypto.py:213`), not in the mapping; `cms-db`'s `PasswordForm` still
    // hands back the payload, so this only proves it is not taken for a hash.
    let form = PasswordForm::parse("plaintext:hunter2").expect("the row parses");
    assert!(form.plaintext().is_some());
    assert!(form.bcrypt().is_none());
}

#[test]
fn storing_a_plaintext_password_is_refused_by_both_entry_points() {
    assert_eq!(
        hash_password("hunter2", "plaintext"),
        Err(CryptoError::PlaintextRefused)
    );
    assert_eq!(
        build_password("hunter2", "plaintext"),
        Err(CryptoError::PlaintextRefused)
    );
    assert_eq!(
        hash_password("hunter2", "md5"),
        Err(CryptoError::UnknownMethod {
            method: "md5".to_string()
        })
    );
}

#[test]
fn a_raw_password_is_not_accepted_where_a_hash_belongs() {
    assert_eq!(
        build_password("hunter2", "bcrypt"),
        Err(CryptoError::NotABcryptHash)
    );
}

#[test]
fn a_password_longer_than_bcrypt_reads_is_refused_rather_than_cut() {
    let too_long = "a".repeat(BCRYPT_MAX_PASSWORD_BYTES + 1);
    assert_eq!(
        hash_password(&too_long, "bcrypt"),
        Err(CryptoError::PasswordTooLong {
            bytes: BCRYPT_MAX_PASSWORD_BYTES + 1
        })
    );
    assert!(hash_password(&"a".repeat(BCRYPT_MAX_PASSWORD_BYTES), "bcrypt").is_ok());
}
