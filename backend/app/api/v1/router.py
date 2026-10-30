from fastapi import APIRouter, Depends

from app.modules.auth.dependencies import csrf_protect
from app.modules.auth.router import router as auth_router
from app.modules.collaboration.router import router as collaboration_router
from app.modules.dashboards.router import router as dashboards_router
from app.modules.health.router import router as health_router
from app.modules.memberships.router import router as memberships_router
from app.modules.notifications.router import router as notifications_router
from app.modules.organizations.router import router as organizations_router
from app.modules.tasks.router import router as tasks_router
from app.modules.users.router import router as me_router

# CSRF is enforced for every unsafe method on the versioned API (ADR-006).
api_router = APIRouter(dependencies=[Depends(csrf_protect)])
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(me_router)
api_router.include_router(tasks_router)
api_router.include_router(dashboards_router)
api_router.include_router(organizations_router)
api_router.include_router(memberships_router)
api_router.include_router(collaboration_router)
api_router.include_router(notifications_router)
