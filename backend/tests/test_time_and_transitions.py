from datetime import date, datetime, time

import pytest

from app.common.time import END_OF_DAY, day_bounds_utc, local_to_utc, local_today, zone
from app.modules.tasks.models import TaskStatus as S
from app.modules.tasks.transitions import can_transition


def test_local_to_utc_respects_offsets() -> None:
    kolkata = zone("Asia/Kolkata")
    assert local_to_utc(date(2026, 10, 30), time(9, 0), kolkata) == datetime(2026, 10, 30, 3, 30)
    # An all-day deadline ends at the last instant of the local day.
    assert local_to_utc(date(2026, 10, 30), END_OF_DAY, kolkata) == datetime(
        2026, 10, 30, 18, 29, 59, 999999
    )


def test_local_today_can_differ_from_utc_date() -> None:
    # 20:00 UTC on the 29th is already 01:30 on the 30th in Kolkata.
    assert local_today(datetime(2026, 10, 29, 20, 0), zone("Asia/Kolkata")) == date(2026, 10, 30)
    assert local_today(datetime(2026, 10, 29, 20, 0), zone("America/Los_Angeles")) == date(
        2026, 10, 29
    )


@pytest.mark.parametrize(
    ("day", "hours"),
    [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25), (date(2026, 6, 1), 24)],
)
def test_day_bounds_follow_dst(day: date, hours: int) -> None:
    start, end = day_bounds_utc(day, zone("America/New_York"))
    assert (end - start).total_seconds() == hours * 3600


@pytest.mark.parametrize(
    ("current", "target", "allowed"),
    [
        (S.NOT_STARTED, S.IN_PROGRESS, True),
        (S.NOT_STARTED, S.COMPLETED, True),
        (S.IN_PROGRESS, S.BLOCKED, True),
        (S.BLOCKED, S.IN_PROGRESS, True),
        (S.BLOCKED, S.COMPLETED, True),
        (S.COMPLETED, S.IN_PROGRESS, True),  # reopen
        (S.CANCELLED, S.NOT_STARTED, True),  # restore
        (S.COMPLETED, S.BLOCKED, False),
        (S.COMPLETED, S.CANCELLED, False),
        (S.CANCELLED, S.COMPLETED, False),
        (S.NOT_STARTED, S.IN_REVIEW, False),
    ],
)
def test_transitions_without_review(current: S, target: S, allowed: bool) -> None:
    assert can_transition(current, target, review_required=False) is allowed


def test_review_required_forces_in_review_before_completion() -> None:
    assert not can_transition(S.IN_PROGRESS, S.COMPLETED, review_required=True)
    assert can_transition(S.IN_PROGRESS, S.IN_REVIEW, review_required=True)
    assert can_transition(S.IN_REVIEW, S.COMPLETED, review_required=True)
