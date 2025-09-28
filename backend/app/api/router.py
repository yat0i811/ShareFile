from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import auth, files, uploads, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(uploads.router)
api_router.include_router(files.router)
api_router.include_router(users.router)
