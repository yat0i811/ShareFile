from __future__ import annotations

import uuid
from datetime import datetime
from typing import List

from pydantic import BaseModel, Field

from app.models.upload import UploadStatus


class CreateSessionRequest(BaseModel):
    filename: str
    size: int = Field(gt=0)
    mime_type: str | None = None
    chunk_size: int = Field(gt=0)
    total_chunks: int = Field(gt=0)
    file_sha256: str


class CreateSessionResponse(BaseModel):
    upload_session_id: uuid.UUID
    accepted_chunk_size: int
    expires_at: datetime


class SessionStatusResponse(BaseModel):
    received: List[int]
    missing: List[int]
    status: UploadStatus


class FinalizeRequest(BaseModel):
    file_sha256: str


class FinalizeResponse(BaseModel):
    upload_session_id: uuid.UUID
    file_id: uuid.UUID | None = None
    status: UploadStatus


class ChunkProbeResponse(BaseModel):
    received: List[int]
    missing: List[int]


class UploadCompletedResponse(BaseModel):
    file_id: uuid.UUID
    status: UploadStatus
