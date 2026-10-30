from fastapi import APIRouter

from app.db.base import utc_now
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.dashboards import service
from app.modules.dashboards.schemas import Period, PersonalDashboard

router = APIRouter(tags=["dashboards"])


@router.get("/me/dashboard", response_model=PersonalDashboard)
def my_dashboard(auth: CurrentAuth, db: DbSession, period: Period = "7d") -> PersonalDashboard:
    return service.personal_dashboard(db, auth.user, period, utc_now())
