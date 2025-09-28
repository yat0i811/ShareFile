from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DownloadLinkDetail(BaseModel):
    id: uuid.UUID
    url: str
    expires_at: datetime | None
    download_count: int
    never_expires: bool
    require_download_page: bool
    has_password: bool
    short_url: str | None = None

    class Config:
        from_attributes = True


class FileResponse(BaseModel):
    id: uuid.UUID
    filename: str
    size: int
    mime_type: str | None
    sha256: str
    status: str
    created_at: datetime
    owner_id: uuid.UUID | None = None
    owner_email: str | None = None
    links: list[DownloadLinkDetail] = []

    class Config:
        from_attributes = True


class CreateLinkRequest(BaseModel):
    expires_in_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 14)
    expires_at: datetime | None = None
    no_expiry: bool = False
    password: str | None = Field(default=None, min_length=4)
    require_download_page: bool = False
    create_short_link: bool = False


class DownloadLinkResponse(BaseModel):
    id: uuid.UUID
    url: str
    expires_at: datetime | None
    download_count: int
    never_expires: bool
    require_download_page: bool
    has_password: bool
    short_url: str | None = None


class FileListResponse(BaseModel):
    files: list[FileResponse]
