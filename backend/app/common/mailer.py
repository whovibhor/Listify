import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from app.core.config import get_settings

logger = logging.getLogger("denote.mail")


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    body: str


class Mailer(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class ConsoleMailer:
    """Development mailer (ADR-017): writes the message to the log instead of sending it."""

    def send(self, message: EmailMessage) -> None:
        logger.info(
            "Email (console backend, not sent)",
            extra={
                "extra_fields": {
                    "to": message.to,
                    "subject": message.subject,
                    "body": message.body,
                }
            },
        )


class OutboxMailer:
    """Test mailer that records messages in memory."""

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.sent.append(message)


@lru_cache
def get_mailer() -> Mailer:
    backend = get_settings().mail_backend
    if backend == "console":
        return ConsoleMailer()
    raise NotImplementedError(
        f"MAIL_BACKEND={backend} is not implemented yet (planned for Phase 8)"
    )
