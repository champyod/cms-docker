#!/usr/bin/env python3

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2018 Stefano Maggiolo <s.maggiolo@gmail.com>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""Tests for the crypto module"""

import re
import unittest

from cmscommon.binary import bin_to_b64
from cmscommon.crypto import build_password, \
    decrypt_binary, decrypt_number, encrypt_binary, encrypt_number, \
    generate_random_password, get_hex_random_key, get_random_key, \
    hash_password, parse_authentication, validate_password


class TestGetRandomKey(unittest.TestCase):
    """Tests for the function get_random_key."""

    def test_it_returns_a_sixteen_byte_key(self):
        # Should be 16 bytes.
        self.assertEqual(len(get_random_key()), 16)


class TestGetHexRandomKey(unittest.TestCase):
    """Tests for the function get_hex_random_key."""

    def test_it_returns_only_hexadecimal_digits(self):
        self.assertRegex(get_hex_random_key(), r"^[0-9a-f]*$")

    def test_it_returns_thirty_two_hexadecimal_digits(self):
        # Should be 16 bytes.
        self.assertEqual(len(get_hex_random_key()), 32)


class TestEncryptAndDecryptBinary(unittest.TestCase):
    """Tests for the functions encrypt_binary and decrypt_binary."""

    def setUp(self):
        super().setUp()
        self.key = get_hex_random_key()

    def test_it_recovers_the_plaintext_after_a_round_trip(self):
        self.assertEqual(
            decrypt_binary(encrypt_binary(b"stuff", self.key), self.key),
            b"stuff")

    def test_it_recovers_an_empty_plaintext_after_a_round_trip(self):
        self.assertEqual(
            decrypt_binary(encrypt_binary(b"", self.key), self.key),
            b"")

    def test_it_recovers_a_megabyte_plaintext_after_a_round_trip(self):
        value = b"0" * 1_000_000
        self.assertEqual(
            decrypt_binary(encrypt_binary(value, self.key), self.key),
            value)

    def test_each_ciphertext_block_is_unique(self):
        # Even if the input is repeated, the output should not be.
        encrypted = encrypt_binary(b"0" * 1_000_000, self.key)
        # The output should appear random, so any sequence of 64 bytes is
        # very unlikely to repeat.
        blocks = re.findall(".{64}", encrypted)
        self.assertEqual(len(blocks), len(set(blocks)))

    def test_the_same_plaintext_encrypts_to_different_ciphertexts(self):
        self.assertNotEqual(encrypt_binary(b"stuff", self.key),
                            encrypt_binary(b"stuff", self.key))

    def test_it_rejects_a_truncated_ciphertext(self):
        encrypted = encrypt_binary(b"stuff", self.key)
        with self.assertRaises(ValueError):
            decrypt_binary(encrypted[1:], self.key)

    def test_it_rejects_a_ciphertext_that_was_not_encrypted_here(self):
        # "stuff" is not decryptable.
        encrypted = bin_to_b64(b"stuff")
        with self.assertRaises(ValueError):
            decrypt_binary(encrypted, self.key)


class TestEncryptAndDecryptNumber(unittest.TestCase):
    """Tests for the functions encrypt_number and decrypt_number."""

    def setUp(self):
        super().setUp()
        self.key = get_hex_random_key()

    def test_it_recovers_a_positive_number_after_a_round_trip(self):
        self.assertEqual(
            decrypt_number(encrypt_number(123, self.key), self.key),
            123)

    def test_it_recovers_a_negative_number_after_a_round_trip(self):
        self.assertEqual(
            decrypt_number(encrypt_number(-123, self.key), self.key),
            -123)

    def test_it_recovers_a_large_number_after_a_round_trip(self):
        self.assertEqual(
            decrypt_number(encrypt_number(10 ** 42, self.key), self.key),
            10 ** 42)


class TestGenerateRandomPassword(unittest.TestCase):
    """Tests for the function generate_random_password."""

    def test_it_returns_only_lowercase_letters(self):
        self.assertRegex(generate_random_password(), r"^[a-z]*$")

    def test_it_returns_a_different_password_each_time(self):
        self.assertNotEqual(generate_random_password(),
                            generate_random_password())


class TestParseAuthentication(unittest.TestCase):
    """Tests for the function parse_authentication."""

    def test_it_splits_the_method_from_the_payload(self):
        method, payload = parse_authentication("plaintext:42")
        self.assertEqual(method, "plaintext")
        self.assertEqual(payload, "42")

    def test_it_keeps_colons_inside_the_payload(self):
        method, payload = parse_authentication("method:42:24")
        self.assertEqual(method, "method")
        self.assertEqual(payload, "42:24")

    def test_it_keeps_non_ascii_characters_in_the_payload(self):
        method, payload = parse_authentication("method:你好")
        self.assertEqual(method, "method")
        self.assertEqual(payload, "你好")

    def test_it_rejects_a_string_without_a_colon(self):
        with self.assertRaises(ValueError):
            parse_authentication("no colon")


class TestBuildPassword(unittest.TestCase):
    """Tests for the function build_password."""

    def test_it_prefixes_an_already_hashed_payload_with_its_method(self):
        payload = parse_authentication(hash_password("pwd"))[1]
        self.assertEqual(build_password(payload, "bcrypt"),
                         "bcrypt:" + payload)

    def test_it_refuses_to_build_a_plaintext_password(self):
        with self.assertRaises(ValueError):
            build_password("secret", "plaintext")

    def test_the_plaintext_refusal_names_the_security_reason(self):
        with self.assertRaises(ValueError) as raised:
            build_password("secret", "plaintext")
        message = str(raised.exception)
        # The message has to explain why, not just fail: the stored value would
        # be the secret itself, readable by anyone who can read the database.
        self.assertIn("plaintext", message)
        self.assertIn("database", message)
        self.assertIn("hash_password", message)

    def test_it_refuses_a_payload_that_is_not_a_bcrypt_hash(self):
        # Handing the "already hashed" builder a raw password would store it
        # verbatim under a bcrypt label.
        with self.assertRaises(ValueError):
            build_password("raw-secret", "bcrypt")

    def test_it_refuses_an_unknown_method(self):
        with self.assertRaises(ValueError):
            build_password("$2b$12$" + "x" * 53, "pwd")

    def test_it_has_no_default_method(self):
        # A default is what let callers with a raw password write plaintext
        # without naming a method; the method must be explicit now.
        with self.assertRaises(TypeError):
            build_password("$2b$12$" + "x" * 53)


class TestHashAndValidatePassword(unittest.TestCase):
    """Tests for the functions hash_password and validate_password."""

    def test_it_hashes_with_bcrypt_by_default(self):
        method, payload = parse_authentication(hash_password("p你好"))
        self.assertEqual(method, "bcrypt")
        self.assertNotEqual(payload, "p你好")
    def test_it_validates_a_bcrypt_password(self):
        self.assertTrue(validate_password(
            hash_password("p你好", method="bcrypt"), "p你好"))
        self.assertFalse(validate_password(
            hash_password("p你好", method="bcrypt"), "你好"))

    def test_it_refuses_a_password_stored_in_plaintext(self):
        # WHY: a "plaintext:" row is the password itself, so comparing it would
        # hand the account to anyone who can read the database. The refusal has
        # to be unconditional, whatever the caller supplies.
        with self.assertLogs("cmscommon.crypto", level="WARNING") as logged:
            self.assertFalse(validate_password(
                "plaintext:some-secret", "some-secret", "someuser"))
        self.assertFalse(validate_password("plaintext:some-secret",
                                           "some-secret"))
        self.assertIn("someuser", logged.output[0])
        # The password itself is not part of the security warning.
        self.assertNotIn("some-secret", logged.output[0])

    def test_it_rejects_a_password_over_72_bytes_when_hashing(self):
        # bcrypt stores at most 72 bytes, so this is where the limit has to be
        # named: a stored truncation would authenticate its own prefix.
        with self.assertRaises(ValueError) as raised:
            hash_password("a" * 73)
        self.assertIn("72", str(raised.exception))
        # The limit is on bytes, not characters: 25 characters, 73 bytes.
        with self.assertRaises(ValueError):
            hash_password("你" * 24 + "a")

    def test_it_refuses_to_store_a_plaintext_password(self):
        with self.assertRaises(ValueError) as raised:
            hash_password("p你好", method="plaintext")
        message = str(raised.exception)
        self.assertIn("plaintext", message)
        self.assertIn("database", message)

    def test_it_hashes_a_password_of_exactly_72_bytes(self):
        # The boundary stays usable: 72 bytes is what bcrypt can hold.
        authentication = hash_password("a" * 72)
        self.assertTrue(validate_password(authentication, "a" * 72))
        self.assertFalse(validate_password(authentication, "a" * 71))

    def test_it_returns_false_for_a_long_candidate_instead_of_raising(self):
        # bcrypt < 5 hashes and compares its own 72-byte truncation, so
        # "a"*72+"tail" compares equal to the stored hash of "a"*72; bcrypt >= 5
        # raises ValueError instead. Neither may reach the login path: the
        # candidate is a definite non-match.
        authentication = hash_password("a" * 72)
        self.assertFalse(validate_password(authentication, "a" * 72 + "tail"))
        self.assertFalse(validate_password(
            hash_password("p你好"), "你" * 24 + "a"))

    def test_it_rejects_an_unknown_method(self):
        with self.assertRaises(ValueError):
            hash_password("test", "pwd")
        with self.assertRaises(ValueError):
            validate_password("test:pwd", "pwd")

    def test_it_accepts_a_password_of_exactly_the_bcrypt_limit(self):
        # 72 bytes is what bcrypt stores; one more would be truncated.
        self.assertEqual(
            parse_authentication(hash_password("a" * 72))[0], "bcrypt")

    def test_it_rejects_a_password_over_the_bcrypt_limit(self):
        with self.assertRaises(ValueError) as raised:
            hash_password("a" * 73)
        self.assertIn("72", str(raised.exception))

    def test_it_counts_the_limit_in_bytes_not_characters(self):
        # "é" is two bytes in UTF-8: 37 of them are 74 bytes, over the limit,
        # even though there are fewer than 72 characters.
        with self.assertRaises(ValueError):
            hash_password("é" * 37)
        self.assertEqual(
            parse_authentication(hash_password("é" * 36))[0], "bcrypt")


if __name__ == "__main__":
    unittest.main()
