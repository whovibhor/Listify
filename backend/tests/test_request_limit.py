"""The request limiter (ADR-032), and what slow clients can and can't hold on to."""

import asyncio
import json
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Engine
from starlette.requests import Request

from app.core.config import Settings
from app.core.middleware import BodySizeLimitMiddleware, RequestLimitMiddleware
from app.main import create_app
from tests.conftest import ApiClient
from tests.factories import create_task, register


def http_scope(path: str = "/api/v1/tasks", method: str = "GET") -> dict[str, Any]:
    return {"type": "http", "path": path, "method": method, "headers": []}


async def empty_body() -> dict[str, Any]:
    return {"type": "http.request", "body": b"", "more_body": False}


class Recorder:
    """Collects what a request sends back."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def __call__(self, message: dict[str, Any]) -> None:
        self.messages.append(message)

    @property
    def status(self) -> int:
        return self.messages[0]["status"]

    @property
    def body(self) -> dict[str, Any]:
        return json.loads(b"".join(m.get("body", b"") for m in self.messages[1:]))

    def header(self, name: bytes) -> bytes | None:
        return dict(self.messages[0]["headers"]).get(name)


async def respond(send: Any) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"{}"})


def test_only_the_limit_runs_at_once_and_everyone_is_served() -> None:
    running = peak = finished = 0

    async def app(_scope: Any, _receive: Any, send: Any) -> None:
        nonlocal running, peak, finished
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        finished += 1
        await respond(send)

    async def main() -> None:
        limited = RequestLimitMiddleware(app, limit=2, wait_seconds=5)
        await asyncio.gather(*(limited(http_scope(), empty_body, Recorder()) for _ in range(10)))

    asyncio.run(main())

    assert peak == 2
    assert finished == 10


def test_waiting_too_long_is_refused_politely() -> None:
    called = 0

    async def app(_scope: Any, _receive: Any, send: Any) -> None:
        nonlocal called
        called += 1
        await asyncio.sleep(0.2)
        await respond(send)

    refused = Recorder()

    async def main() -> None:
        limited = RequestLimitMiddleware(app, limit=1, wait_seconds=0.02)
        first = asyncio.create_task(limited(http_scope(), empty_body, Recorder()))
        await asyncio.sleep(0)
        await limited(http_scope(), empty_body, refused)
        await first

    asyncio.run(main())

    assert refused.status == 503
    assert refused.body["error"]["code"] == "server_busy"
    assert refused.header(b"retry-after") == b"5"
    assert called == 1


def test_a_response_being_read_slowly_gives_its_slot_back() -> None:
    """A download keeps sending for as long as the client takes, and holds nothing meanwhile."""
    client_is_slow = None

    async def app(scope: Any, _receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        if scope["path"] == "/download":
            await client_is_slow.wait()
        await send({"type": "http.response.body", "body": b"{}"})

    next_request = Recorder()

    async def main() -> None:
        nonlocal client_is_slow
        client_is_slow = asyncio.Event()
        limited = RequestLimitMiddleware(app, limit=1, wait_seconds=1)
        download = asyncio.create_task(limited(http_scope("/download"), empty_body, Recorder()))
        await asyncio.sleep(0)
        await limited(http_scope("/other"), empty_body, next_request)
        client_is_slow.set()
        await download

    asyncio.run(main())

    assert next_request.status == 200


def test_a_request_body_arriving_slowly_holds_no_slot() -> None:
    """Otherwise a few dozen clients sending a form slowly could lock everyone out."""
    finish_sending = None

    async def slow_body() -> dict[str, Any]:
        await finish_sending.wait()
        return {"type": "http.request", "body": b"late", "more_body": False}

    received: list[bytes] = []

    async def app(_scope: Any, receive: Any, send: Any) -> None:
        received.append((await receive())["body"])
        await respond(send)

    other_request = Recorder()

    async def main() -> None:
        nonlocal finish_sending
        finish_sending = asyncio.Event()
        limited = RequestLimitMiddleware(app, limit=1, wait_seconds=1)
        slow = asyncio.create_task(limited(http_scope(), slow_body, Recorder()))
        await asyncio.sleep(0)
        await limited(http_scope(), empty_body, other_request)
        finish_sending.set()
        await slow

    asyncio.run(main())

    assert other_request.status == 200
    assert received == [b"", b"late"]


def test_a_body_in_several_parts_reaches_the_app_whole() -> None:
    parts = iter([(b"one", True), (b"two", False)])

    async def receive() -> dict[str, Any]:
        body, more = next(parts)
        return {"type": "http.request", "body": body, "more_body": more}

    seen: list[bytes] = []

    async def app(_scope: Any, app_receive: Any, send: Any) -> None:
        seen.append((await app_receive())["body"])
        seen.append((await app_receive())["body"])
        await respond(send)

    limited = RequestLimitMiddleware(app, limit=1, wait_seconds=1)
    asyncio.run(limited(http_scope(method="POST"), receive, Recorder()))

    assert seen == [b"one", b"two"]


def test_a_crash_gives_the_slot_back() -> None:
    fail = True

    async def app(_scope: Any, _receive: Any, send: Any) -> None:
        nonlocal fail
        if fail:
            fail = False
            raise RuntimeError("boom")
        await respond(send)

    after = Recorder()

    async def main() -> None:
        limited = RequestLimitMiddleware(app, limit=1, wait_seconds=0.1)
        with pytest.raises(RuntimeError):
            await limited(http_scope(), empty_body, Recorder())
        await limited(http_scope(), empty_body, after)

    asyncio.run(main())

    assert after.status == 200


def test_an_oversized_chunked_body_is_refused_while_it_is_read() -> None:
    async def too_much() -> dict[str, Any]:
        raise HTTPException(413, "This request is too large.")

    async def app(*_: Any) -> None:
        raise AssertionError("the app must not run")

    refused = Recorder()
    limited = RequestLimitMiddleware(app, limit=1, wait_seconds=1)
    asyncio.run(limited(http_scope(method="POST"), too_much, refused))

    assert refused.status == 413
    assert refused.body["error"]["code"] == "payload_too_large"


@pytest.mark.parametrize(
    ("method", "path", "exempt"),
    [
        ("GET", "/api/v1/health", True),
        ("POST", "/api/v1/tasks/5/attachments", True),
        ("GET", "/api/v1/tasks/5/attachments", False),
        ("POST", "/api/v1/tasks/5/comments", False),
        ("GET", "/api/v1/attachments/5/download", False),
    ],
)
def test_only_health_checks_and_uploads_skip_the_line(method: str, path: str, exempt: bool) -> None:
    calls = 0

    async def app(_scope: Any, _receive: Any, send: Any) -> None:
        nonlocal calls
        calls += 1
        await respond(send)

    async def main() -> None:
        limited = RequestLimitMiddleware(app, limit=1, wait_seconds=0.01)
        await limited.slots.acquire()  # every slot is taken
        await limited(http_scope(path, method), empty_body, Recorder())

    asyncio.run(main())

    assert calls == (1 if exempt else 0)


def test_the_limiter_sits_inside_the_other_middleware(settings: Settings) -> None:
    """So a refusal still gets CORS, security headers and a request ID, and bodies get measured."""
    layers = [layer.cls for layer in create_app(settings).user_middleware]

    assert layers[-1] is RequestLimitMiddleware
    assert layers[-2] is BodySizeLimitMiddleware


def test_a_busy_refusal_looks_like_any_other_error(settings: Settings) -> None:
    app = create_app(settings)

    with TestClient(app) as client:
        client.get("/api/v1/health")  # builds the middleware
        limiter = app.middleware_stack
        while not isinstance(limiter, RequestLimitMiddleware):
            limiter = limiter.app
        limiter.wait_seconds = 0.01
        limiter.slots._value = 0  # every slot is taken

        refused = client.get("/api/v1/me", headers={"X-Request-ID": "busy-test"})

    assert refused.status_code == 503
    assert refused.json()["error"]["code"] == "server_busy"
    assert refused.json()["error"]["request_id"] == "busy-test"
    assert refused.headers["X-Content-Type-Options"] == "nosniff"
    assert refused.headers["Retry-After"] == "5"


def test_production_refuses_a_limit_the_app_cant_serve() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None, app_env="production", max_concurrent_requests=40)

    assert "MAX_CONCURRENT_REQUESTS" in str(exc_info.value)


def test_the_default_limit_leaves_room_for_uploads_and_health_checks() -> None:
    settings = Settings(_env_file=None, app_env="test")

    assert settings.max_concurrent_requests < settings.db_pool_size + settings.db_max_overflow


def test_an_upload_holds_no_connection_while_the_file_arrives(
    api: ApiClient, test_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """45 paused uploads once held every connection and froze the whole app (ADR-032)."""
    register(api)
    task = create_task(api, "Files")
    held: list[int] = []
    original = Request.body

    async def spy(self: Request) -> bytes:
        held.append(test_engine.pool.checkedout())
        return await original(self)

    monkeypatch.setattr(Request, "body", spy)

    response = api.post(
        f"/api/v1/tasks/{task['id']}/attachments",
        params={"filename": "notes.txt"},
        content=b"notes",
        headers={"Content-Type": "application/octet-stream"},
    )

    assert response.status_code == 201, response.text
    assert held == [0]
