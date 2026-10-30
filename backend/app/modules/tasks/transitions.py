"""Task status transition policy (ADR-015)."""

from app.modules.tasks.models import TaskStatus as S

# Transitions allowed when review is NOT required (personal workspace; orgs with review off).
_WITHOUT_REVIEW: dict[S, frozenset[S]] = {
    S.NOT_STARTED: frozenset({S.IN_PROGRESS, S.COMPLETED, S.CANCELLED}),
    S.IN_PROGRESS: frozenset({S.NOT_STARTED, S.BLOCKED, S.COMPLETED, S.CANCELLED}),
    S.BLOCKED: frozenset({S.IN_PROGRESS, S.COMPLETED, S.CANCELLED}),
    S.IN_REVIEW: frozenset({S.IN_PROGRESS, S.COMPLETED, S.CANCELLED}),
    S.COMPLETED: frozenset({S.IN_PROGRESS}),  # reopen
    S.CANCELLED: frozenset({S.NOT_STARTED}),  # restore
}

# With review required, work must pass through In Review before Completed.
_WITH_REVIEW: dict[S, frozenset[S]] = {
    **_WITHOUT_REVIEW,
    S.NOT_STARTED: frozenset({S.IN_PROGRESS, S.CANCELLED}),
    S.IN_PROGRESS: frozenset({S.NOT_STARTED, S.BLOCKED, S.IN_REVIEW, S.CANCELLED}),
    S.BLOCKED: frozenset({S.IN_PROGRESS, S.CANCELLED}),
}

# The reopen target when a completed task is un-ticked.
REOPEN_STATUS = S.IN_PROGRESS


def allowed_targets(current: S, *, review_required: bool) -> frozenset[S]:
    return (_WITH_REVIEW if review_required else _WITHOUT_REVIEW)[current]


def can_transition(current: S, target: S, *, review_required: bool) -> bool:
    return target in allowed_targets(current, review_required=review_required)
