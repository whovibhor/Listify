import hashlib
import hmac
import secrets

SESSION_COOKIE = "listify_session"
CSRF_COOKIE = "listify_csrf"
CSRF_HEADER = "X-CSRF-Token"


def new_token() -> str:
    """256-bit URL-safe random token."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token_for_session(session_token: str, secret: str) -> str:
    """CSRF token bound to a session (ADR-006); it cannot be minted without the secret."""
    return hmac.new(secret.encode(), f"csrf:{session_token}".encode(), hashlib.sha256).hexdigest()


def tokens_match(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    # As bytes: comparing text raises an error on any non-ASCII input.
    return hmac.compare_digest(a.encode(), b.encode())
