import logging
import re
import secrets
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

logger = logging.getLogger("listify.storage")

CHUNK_BYTES = 64 * 1024
_KEY_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class StorageBackend(Protocol):
    """Where attachment files live (ADR-018). S3-compatible storage can replace this later."""

    def save(self, content: bytes) -> str: ...

    def stream(self, key: str) -> Iterator[bytes]: ...

    def exists(self, key: str) -> bool: ...

    def delete(self, key: str) -> None: ...


class LocalStorage:
    """Files under one folder, named by random keys, never by anything a user typed."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        # Keys come from the database, but a path must never be built from an unchecked value.
        if not _KEY_PATTERN.match(key):
            raise ValueError("Invalid storage key")
        return self.root / key[:2] / key

    def save(self, content: bytes) -> str:
        key = secrets.token_hex(32)
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".part")
        temporary.write_bytes(content)
        temporary.replace(path)
        return key

    def stream(self, key: str) -> Iterator[bytes]:
        with self._path(key).open("rb") as file:
            while chunk := file.read(CHUNK_BYTES):
                yield chunk

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except OSError:
            # The record is already gone, so a leftover file is only wasted space.
            logger.exception("Could not delete a stored file")


@lru_cache
def get_storage() -> StorageBackend:
    return LocalStorage(get_settings().storage_dir)
