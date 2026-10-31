import asyncio
import re

from fastapi import HTTPException, status
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.exceptions import error_response

# Far above any real request: the longest text field is 10,000 characters.
MAX_BODY_BYTES = 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_UPLOAD_PATH = re.compile(r"^/api/v1/tasks/\d+/attachments$")
TOO_LARGE_MESSAGE = "This request is too large."
API_PATH_PREFIX = "/api/v1"
_HEALTH_PATH = f"{API_PATH_PREFIX}/health"
BUSY_MESSAGE = "The server is busy right now. Please try again in a moment."
BUSY_RETRY_SECONDS = "5"


class BodySizeLimitMiddleware:
    """Refuses oversized requests before they're read into memory (S-09)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = MAX_UPLOAD_BYTES if _UPLOAD_PATH.match(scope["path"]) else MAX_BODY_BYTES
        declared = Headers(scope=scope).get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
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
                if received > limit:
                    raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE_MESSAGE)
            return message

        await self.app(scope, counted_receive, send)


def _is_exempt(scope: Scope) -> bool:
    """Health checks must answer during an overload, and uploads pause for as long as a client
    takes to send the file. They release their connection first, so they hold nothing."""
    if scope["path"] == _HEALTH_PATH:
        return True
    return scope["method"] == "POST" and _UPLOAD_PATH.match(scope["path"]) is not None


async def _read_body(receive: Receive) -> list[Message]:
    messages = []
    while True:
        message = await receive()
        messages.append(message)
        if message["type"] != "http.request" or not message.get("more_body"):
            return messages


class RequestLimitMiddleware:
    """Lets a set number of requests in at once; the rest wait here, holding nothing (ADR-032).

    Past that number, requests hold threads while waiting for a connection, and the requests
    holding connections can't get a thread to finish, so everything stalls until the pool times
    out.

    A request takes its slot only once its body has arrived, and gives it back when its response
    starts, so slow clients can't occupy slots while sending or receiving.
    """

    def __init__(self, app: ASGIApp, *, limit: int, wait_seconds: float) -> None:
        self.app = app
        self.slots = asyncio.Semaphore(limit)
        self.wait_seconds = wait_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or _is_exempt(scope):
            await self.app(scope, receive, send)
            return

        try:
            arrived = await _read_body(receive)
        except HTTPException as exc:  # the size limit, which wraps this middleware
            response = error_response(exc.status_code, "payload_too_large", exc.detail)
            await response(scope, receive, send)
            return

        try:
            async with asyncio.timeout(self.wait_seconds):
                await self.slots.acquire()
        except TimeoutError:
            response = error_response(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "server_busy",
                BUSY_MESSAGE,
                headers={"Retry-After": BUSY_RETRY_SECONDS},
            )
            await response(scope, receive, send)
            return

        held = True

        def release() -> None:
            nonlocal held
            if held:
                held = False
                self.slots.release()

        async def replayed_receive() -> Message:
            return arrived.pop(0) if arrived else await receive()

        async def send_and_release(message: Message) -> None:
            if message["type"] == "http.response.start":
                release()
            await send(message)

        try:
            await self.app(scope, replayed_receive, send_and_release)
        finally:
            release()


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
