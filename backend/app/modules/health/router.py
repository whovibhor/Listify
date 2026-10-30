from typing import Literal

from fastapi import APIRouter, Depends, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.modules.health.service import DatabaseProbe, DependencyStatus, get_database_probe

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    environment: str
    checks: dict[str, DependencyStatus]


@router.get("/health", response_model=HealthResponse)
async def health(
    response: Response,
    settings: Settings = Depends(get_settings),
    probe: DatabaseProbe = Depends(get_database_probe),
) -> HealthResponse:
    database = await run_in_threadpool(probe)
    healthy = database.status == "ok"
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(
        status="ok" if healthy else "degraded",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
        checks={"database": database},
    )
