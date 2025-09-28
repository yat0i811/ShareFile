from __future__ import annotations

import hashlib
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api import deps
from app.core.config import settings
from app.models.user import User
from app.models.upload import UploadStatus
from app.schemas.upload import (
    CreateSessionRequest,
    CreateSessionResponse,
    FinalizeRequest,
    FinalizeResponse,
    SessionStatusResponse,
)
from app.services import uploads as upload_service
from app.services.storage import storage_service
from app.worker import finalize_upload_task

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(
    payload: CreateSessionRequest,
    db: deps.DatabaseSessionDep,
    current_user: User = Depends(deps.get_current_user),
) -> CreateSessionResponse:
    accepted_chunk_size = min(payload.chunk_size, settings.max_chunk_size)
    payload.chunk_size = accepted_chunk_size

    session = await upload_service.create_upload_session(db, payload, owner=current_user)
    return CreateSessionResponse(
        upload_session_id=session.id,
        accepted_chunk_size=session.chunk_size,
        expires_at=session.expires_at,
    )


@router.get("/sessions/{session_id}", response_model=SessionStatusResponse)
async def get_session_status(
    session_id: uuid.UUID,
    db: deps.DatabaseSessionDep,
    current_user: User = Depends(deps.get_current_user),
) -> SessionStatusResponse:
    session = await upload_service.get_upload_session(db, session_id)
    if session.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")
    received = await upload_service.session_received_indexes(db, session)
    received_set = set(received)
    missing = [idx for idx in range(session.total_chunks) if idx not in received_set]
    return SessionStatusResponse(received=sorted(received), missing=missing, status=session.status)


@router.put("/sessions/{session_id}/chunk/{index}")
async def upload_chunk(
    session_id: uuid.UUID,
    index: int,
    request: Request,
    db: deps.DatabaseSessionDep,
    current_user: User = Depends(deps.get_current_user),
) -> dict[str, Any]:
    session = await upload_service.get_upload_session(db, session_id)
    if session.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

    if session.status not in {UploadStatus.UPLOADING, UploadStatus.INIT}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session not accepting chunks")
    if index < 0 or index >= session.total_chunks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid chunk index")

    raw_data = await request.body()
    actual_size = len(raw_data)

    expected_size = request.headers.get("X-Chunk-Size")
    if expected_size is not None and actual_size != int(expected_size):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chunk size mismatch")

    if actual_size == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty chunk")
    if actual_size > settings.max_chunk_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Chunk too large")

    checksum_header = request.headers.get("X-Chunk-Checksum")
    computed_checksum = hashlib.sha256(raw_data).hexdigest()
    if checksum_header and checksum_header.lower() != computed_checksum.lower():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Checksum mismatch")

    stored_path = await storage_service.write_chunk(str(session.id), index, raw_data)
    await upload_service.record_chunk(db, session, index, computed_checksum, actual_size, str(stored_path))

    return {"received": index, "size": actual_size}


@router.post("/sessions/{session_id}/finalize", response_model=FinalizeResponse)
async def finalize_session(
    session_id: uuid.UUID,
    payload: FinalizeRequest,
    db: deps.DatabaseSessionDep,
    current_user: User = Depends(deps.get_current_user),
) -> FinalizeResponse:
    session = await upload_service.get_upload_session(db, session_id)
    if session.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")

    if session.status not in {UploadStatus.UPLOADING, UploadStatus.FINALIZING}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session not finalizable")

    if payload.file_sha256.lower() != session.file_sha256.lower():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File hash mismatch")

    received = await upload_service.session_received_indexes(db, session)
    missing = [idx for idx in range(session.total_chunks) if idx not in set(received)]
    if missing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Incomplete upload")

    await upload_service.mark_session_finalizing(db, session)
    stored_file = await upload_service.create_file_record(db, session)

    finalize_upload_task.delay(str(session.id), str(stored_file.id))

    return FinalizeResponse(upload_session_id=session.id, file_id=stored_file.id, status=session.status)
