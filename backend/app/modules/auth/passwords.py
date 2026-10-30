from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128

# Long-but-common choices that pass the length rule (NIST 800-63B: block known-bad passwords).
_COMMON_PASSWORDS = frozenset(
    {
        "123456789012",
        "1234567890123",
        "12345678901234",
        "password1234",
        "password12345",
        "password123456",
        "passwordpassword",
        "qwertyuiopas",
        "qwerty123456",
        "qwertyuiop123",
        "iloveyou1234",
        "letmein12345",
        "welcome12345",
        "administrator",
        "abc123456789",
        "aaaaaaaaaaaa",
        "111111111111",
        "000000000000",
        "workpulse123",
        "workpulse1234",
        "changeme1234",
    }
)

_hasher = PasswordHasher()  # Argon2id with library defaults (ADR-007)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return _hasher.hash("timing-equalizer-not-a-real-password")


def burn_verification_time(password: str) -> None:
    """Verifies against a dummy hash so unknown emails take as long as wrong passwords."""
    verify_password(_dummy_hash(), password)


def password_problems(password: str, *, email: str, name: str = "") -> list[str]:
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"Use at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > MAX_PASSWORD_LENGTH:
        problems.append(f"Use at most {MAX_PASSWORD_LENGTH} characters.")
    lowered = password.lower()
    if lowered in _COMMON_PASSWORDS or len(set(password)) <= 2:
        problems.append("This password is too common or too easy to guess.")
    local_part = email.split("@", 1)[0].lower()
    if (len(local_part) >= 4 and local_part in lowered) or lowered == email.lower():
        problems.append("Don't include your email address in your password.")
    if name and len(name) >= 4 and name.lower().replace(" ", "") == lowered:
        problems.append("Don't use your name as your password.")
    return problems
