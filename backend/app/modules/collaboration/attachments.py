"""File attachments (ADR-018). Every download goes through the task's access check."""

import re
from collections.abc import Iterator
from datetime import timedelta
from pathlib import PurePosixPath
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common import rate_limit
from app.common.storage import StorageBackend
from app.core.exceptions import AppError, ConflictError, ForbiddenError, NotFoundError
from app.core.middleware import MAX_UPLOAD_BYTES
from app.modules.collaboration.models import TaskAttachment
from app.modules.collaboration.schemas import AttachmentRead
from app.modules.tasks import policies, service
from app.modules.tasks.policies import TaskAccess
from app.modules.tasks.schemas import PersonRef
from app.modules.tasks.service import TaskArchivedError
from app.modules.users.models import User

UPLOADS_PER_USER = rate_limit.RateLimit("upload:user", 100, timedelta(hours=1))
MAX_ATTACHMENTS_PER_TASK = 20
MAX_FILENAME_LENGTH = 255

_OFFICE_OR_ZIP = (b"PK\x03\x04",)
# Extension → (content type sent on download, what the file must start with).
# HTML and SVG are left out on purpose: both can carry scripts. Plain text has no signature, so it
# gets its own check below.
ALLOWED_TYPES: dict[str, tuple[str, tuple[bytes, ...]]] = {
    ".pdf": ("application/pdf", (b"%PDF-",)),
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".gif": ("image/gif", (b"GIF87a", b"GIF89a")),
    ".webp": ("image/webp", (b"RIFF",)),
    ".txt": ("text/plain", ()),
    ".csv": ("text/csv", ()),
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _OFFICE_OR_ZIP,
    ),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _OFFICE_OR_ZIP),
    ".pptx": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _OFFICE_OR_ZIP,
    ),
    ".zip": ("application/zip", _OFFICE_OR_ZIP),
}
_UNSAFE_IN_NAME = re.compile(r"[\x00-\x1f\x7f\"\\/:*?<>|]")


class AttachmentRejectedError(AppError):
    status_code = 422
    code = "attachment_rejected"


class TooManyAttachmentsError(ConflictError):
    code = "too_many_attachments"


def clean_filename(raw: str) -> str:
    """The last path part, without characters that could break a header or a download dialog."""
    name = PurePosixPath(raw.replace("\\", "/")).name
    name = _UNSAFE_IN_NAME.sub("_", name).strip(" .")
    if not name:
        raise AttachmentRejectedError("This file needs a name.")
    if len(name) > MAX_FILENAME_LENGTH:
        stem, _, extension = name.rpartition(".")
        name = f"{stem[: MAX_FILENAME_LENGTH - len(extension) - 1]}.{extension}"
    return name


def check_content(filename: str, content: bytes) -> str:
    """Decides the type from the file's actual bytes. What the browser claims is ignored."""
    extension = PurePosixPath(filename).suffix.lower()
    allowed = ALLOWED_TYPES.get(extension)
    if allowed is None:
        raise AttachmentRejectedError("This type of file can't be attached.")
    content_type, signatures = allowed
    if not content:
        raise AttachmentRejectedError("This file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise AttachmentRejectedError("Files can be at most 10 MB.")
    if signatures:
        valid = content.startswith(signatures)
        if extension == ".webp":
            valid = valid and content[8:12] == b"WEBP"
    else:
        valid = _is_text(content)
    if not valid:
        raise AttachmentRejectedError("This file's contents don't match its type.")
    return content_type


def _is_text(content: bytes) -> bool:
    if b"\x00" in content:
        return False
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def _can_delete(attachment: TaskAttachment, access: TaskAccess, user: User) -> bool:
    return attachment.uploaded_by == user.id or access.can("archive")


def _to_read(attachment: TaskAttachment, access: TaskAccess, user: User) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        task_id=attachment.task_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        uploaded_by=PersonRef(id=attachment.uploader.id, name=attachment.uploader.name),
        created_at=attachment.created_at,
        can_delete=_can_delete(attachment, access, user),
    )


def list_attachments(db: Session, access: TaskAccess, user: User) -> list[AttachmentRead]:
    attachments = db.scalars(
        select(TaskAttachment)
        .where(TaskAttachment.task_id == access.task.id)
        .order_by(TaskAttachment.created_at, TaskAttachment.id)
    ).all()
    return [_to_read(attachment, access, user) for attachment in attachments]


def add_attachment(
    db: Session,
    user: User,
    task_id: int,
    raw_filename: str,
    content: bytes,
    storage: StorageBackend,
) -> AttachmentRead:
    access = policies.get_access(db, user, task_id)
    access.require("edit")
    task = access.task
    if task.parent_task_id is not None:
        raise AttachmentRejectedError("Attach files to the parent task.")
    if task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task to attach files.")
    filename = clean_filename(raw_filename)
    content_type = check_content(filename, content)
    count = db.scalar(
        select(func.count()).select_from(TaskAttachment).where(TaskAttachment.task_id == task.id)
    )
    if (count or 0) >= MAX_ATTACHMENTS_PER_TASK:
        raise TooManyAttachmentsError(
            f"A task can have at most {MAX_ATTACHMENTS_PER_TASK} attachments."
        )
    rate_limit.hit(db, UPLOADS_PER_USER, str(user.id))

    key = storage.save(content)
    try:
        attachment = TaskAttachment(
            task_id=task.id,
            uploaded_by=user.id,
            filename=filename,
            content_type=content_type,
            size_bytes=len(content),
            storage_key=key,
        )
        db.add(attachment)
        service.record(db, task, user, "attachment_added", new={"filename": filename})
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(key)
        raise
    db.refresh(attachment)
    return _to_read(attachment, access, user)


def _load(db: Session, user: User, attachment_id: int) -> tuple[TaskAttachment, TaskAccess]:
    attachment = db.get(TaskAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    try:
        access = policies.get_access(db, user, attachment.task_id)
    except NotFoundError as exc:
        raise NotFoundError("Attachment not found.") from exc
    return attachment, access


def open_download(
    db: Session, user: User, attachment_id: int, storage: StorageBackend
) -> tuple[Iterator[bytes], TaskAttachment]:
    attachment, _ = _load(db, user, attachment_id)
    if not storage.exists(attachment.storage_key):
        raise NotFoundError("Attachment not found.")
    return storage.stream(attachment.storage_key), attachment


def download_headers(attachment: TaskAttachment) -> dict[str, str]:
    """Always a download, never shown inside the page, so a file can't act as part of the app."""
    ascii_name = attachment.filename.encode("ascii", "replace").decode().replace("?", "_")
    return {
        "Content-Disposition": (
            f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(attachment.filename)}"
        ),
        "Content-Length": str(attachment.size_bytes),
    }


def delete_attachment(db: Session, user: User, attachment_id: int, storage: StorageBackend) -> None:
    attachment, access = _load(db, user, attachment_id)
    if not _can_delete(attachment, access, user):
        raise ForbiddenError("You can't delete this attachment.")
    if access.task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task to change it.")
    key = attachment.storage_key
    service.record(
        db, access.task, user, "attachment_removed", old={"filename": attachment.filename}
    )
    db.delete(attachment)
    db.commit()
    storage.delete(key)


def storage_keys_of(db: Session, task_id: int) -> list[str]:
    return list(
        db.scalars(select(TaskAttachment.storage_key).where(TaskAttachment.task_id == task_id))
    )
