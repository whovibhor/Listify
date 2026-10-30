import pytest

from app.modules.auth.passwords import (
    hash_password,
    needs_rehash,
    password_problems,
    verify_password,
)


def test_hash_is_argon2id_and_verifies() -> None:
    hashed = hash_password("a long enough passphrase")

    assert hashed.startswith("$argon2id$")
    assert verify_password(hashed, "a long enough passphrase")
    assert not verify_password(hashed, "a long enough passphrasE")
    assert not needs_rehash(hashed)


def test_verify_rejects_garbage_hash_without_raising() -> None:
    assert verify_password("not-a-hash", "anything") is False


@pytest.mark.parametrize(
    ("password", "expected_fragment"),
    [
        ("short", "at least 12"),
        ("x" * 129, "at most 128"),
        ("password1234", "too common"),
        ("aaaaaaaaaaaaaaaa", "too common"),
        ("ada.lovelace-rocks!", "email address"),
    ],
)
def test_password_problems(password: str, expected_fragment: str) -> None:
    problems = password_problems(password, email="ada.lovelace@example.com")
    assert any(expected_fragment in problem for problem in problems)


def test_good_passphrase_has_no_problems() -> None:
    assert password_problems("correct horse battery staple", email="ada@example.com") == []
