from fastapi import APIRouter, Depends

from app.modules.auth.dependencies import csrf_protect
from app.modules.auth.router import router as auth_router
from app.modules.dashboards.router import router as dashboards_router
from app.modules.health.router import router as health_router
from app.modules.tasks.router import router as tasks_router
from app.modules.users.router import router as me_router

# CSRF is enforced for every unsafe method on the versioned API (ADR-006).
api_router = APIRouter(dependencies=[Depends(csrf_protect)])
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(me_router)
api_router.include_router(tasks_router)
api_router.include_router(dashboards_router)
