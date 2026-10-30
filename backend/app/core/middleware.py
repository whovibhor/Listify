from fastapi import HTTPException, status
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.exceptions import error_response

# Far above any real request: the longest text field is 10,000 characters. Uploads (Phase 6) will
# have their own limit.
MAX_BODY_BYTES = 1024 * 1024
TOO_LARGE_MESSAGE = "This request is too large."
API_PATH_PREFIX = "/api/v1"


class BodySizeLimitMiddleware:
    """Refuses oversized requests before they're read into memory (S-09)."""

    def __init__(self, app: ASGIApp, *, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            response = error_response(
                status.HTTP_413_CONTENT_TOO_LARGE, "payload_too_large", TOO_LARGE_MESSAGE
            )
            await response(scope, receive, send)
            return

        # A chunked request declares no length, so it's counted as it arrives.
        received = 0

        async def counted_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE_MESSAGE)
            return message

        await self.app(scope, counted_receive, send)


class SecurityHeadersMiddleware:
    """Browser protections on every response (S-08). The frontend's own headers come from Nginx."""

    def __init__(self, app: ASGIApp, *, strict_transport: bool) -> None:
        self.app = app
        self.strict_transport = strict_transport

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_api = scope["path"].startswith(API_PATH_PREFIX)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "no-referrer"
                # Only the JSON API: the development docs page needs scripts and a local cache.
                if is_api:
                    headers["Cache-Control"] = "no-store"
                    headers["Content-Security-Policy"] = (
                        "default-src 'none'; frame-ancestors 'none'"
                    )
                if self.strict_transport:
                    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            await send(message)

        await self.app(scope, receive, send_with_headers)
