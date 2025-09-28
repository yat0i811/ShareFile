from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.routes.files import public_router as download_router
from app.core.config import settings
from app.db.base import Base
from app.db.session import async_session_factory, engine
from app.services.storage import storage_service
from app.services.users import ensure_admin_user

logger = logging.getLogger(__name__)


def create_application() -> FastAPI:
    app = FastAPI(title=settings.project_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def startup_event() -> None:  # noqa: D401
        storage_service.ensure_base_dirs()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_session_factory() as session:
            await ensure_admin_user(
                session,
                email=settings.admin_email,
                password_hash=settings.effective_admin_password_hash,
            )
        logger.info("Storage directories ensured under %s", settings.storage_root)

    app.include_router(api_router, prefix=settings.api_prefix)
    app.include_router(download_router)

    @app.get("/healthz")
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_application()
