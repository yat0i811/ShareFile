from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
import secrets
import string
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.upload import DownloadLink, FileStatus, StoredFile, UploadChunk, UploadSession, UploadStatus
from app.models.user import User
from app.schemas.upload import CreateSessionRequest
from app.services.storage import storage_service
from app.services.users import increment_used_bytes
from app.utils.security import create_download_token


async def create_upload_session(db: AsyncSession, payload: CreateSessionRequest, *, owner: User) -> UploadSession:
    if payload.chunk_size > settings.max_chunk_size:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Chunk size too large")
    if owner.quota_bytes is not None and owner.used_bytes + payload.size > owner.quota_bytes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Quota exceeded")

    storage_service.ensure_base_dirs()

    session = UploadSession(
        owner_id=owner.id,
        filename=payload.filename,
        size=payload.size,
        mime_type=payload.mime_type,
        chunk_size=payload.chunk_size,
        total_chunks=payload.total_chunks,
        file_sha256=payload.file_sha256,
        status=UploadStatus.UPLOADING,
        expires_at=UploadSession.build_expiration(),
        upload_path="",
    )

    db.add(session)
    await db.flush()
    session.upload_path = str(storage_service.session_tmp_dir(str(session.id)))
    await db.commit()
    await db.refresh(session)
    return session


async def get_upload_session(db: AsyncSession, session_id: uuid.UUID) -> UploadSession:
    result = await db.execute(select(UploadSession).where(UploadSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found")
    return session


async def record_chunk(
    db: AsyncSession,
    session: UploadSession,
    index: int,
    checksum: str,
    size: int,
    stored_path: str,
) -> UploadChunk:
    existing_stmt = select(UploadChunk).where(
        UploadChunk.session_id == session.id, UploadChunk.index == index
    )
    existing_chunk = (await db.execute(existing_stmt)).scalar_one_or_none()

    if existing_chunk:
        if existing_chunk.checksum != checksum:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Checksum mismatch on duplicate chunk")
        return existing_chunk

    chunk = UploadChunk(
        session_id=session.id,
        index=index,
        checksum=checksum,
        size=size,
        stored_path=stored_path,
    )
    db.add(chunk)
    try:
        await db.commit()
    except IntegrityError as exc:  # race condition safe-guard
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chunk already recorded") from exc
    await db.refresh(chunk)
    return chunk


async def session_received_indexes(db: AsyncSession, session: UploadSession) -> list[int]:
    stmt = select(UploadChunk.index).where(UploadChunk.session_id == session.id)
    result = await db.execute(stmt)
    return [row[0] for row in result.all()]


async def mark_session_finalizing(db: AsyncSession, session: UploadSession) -> None:
    session.status = UploadStatus.FINALIZING
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()


async def create_file_record(db: AsyncSession, session: UploadSession) -> StoredFile:
    stored_file = StoredFile(
        session_id=session.id,
        owner_id=session.owner_id,
        filename=session.filename,
        size=session.size,
        mime_type=session.mime_type,
        sha256=session.file_sha256,
        storage_path="",
        status=FileStatus.PENDING,
    )
    db.add(stored_file)
    await db.flush()
    stored_file.storage_path = str(storage_service.final_file_path(str(stored_file.id)))
    await db.commit()
    await db.refresh(stored_file)
    return stored_file


async def mark_file_ready(db: AsyncSession, file: StoredFile) -> StoredFile:
    file.status = FileStatus.READY
    file.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(file)
    return file


async def mark_session_completed(db: AsyncSession, session: UploadSession) -> None:
    session.status = UploadStatus.COMPLETED
    session.finalized_at = datetime.now(timezone.utc)
    await db.commit()


async def create_download_link_record(
    db: AsyncSession,
    file: StoredFile,
    token: str,
    expires_at: datetime,
    one_time: bool,
    password_hash: bytes | None,
    require_download_page: bool,
    short_code: str | None,
) -> DownloadLink:
    record = DownloadLink(
        file_id=file.id,
        token=token,
        expires_at=expires_at,
        one_time=one_time,
        download_count=0,
        password_hash=password_hash,
        is_enabled=True,
        require_download_page=require_download_page,
        short_code=short_code,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def issue_download_token(
    file: StoredFile,
    expires_at: datetime,
    one_time: bool,
) -> tuple[str, datetime]:
    token = create_download_token(str(file.id), expires_at, one_time)
    return token, expires_at


async def generate_unique_short_code(db: AsyncSession, length: int = 8) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        candidate = ''.join(secrets.choice(alphabet) for _ in range(length))
        result = await db.execute(select(DownloadLink).where(DownloadLink.short_code == candidate))
        if result.scalar_one_or_none() is None:
            return candidate


async def get_file_by_id(db: AsyncSession, file_id: uuid.UUID) -> StoredFile | None:
    stmt = (
        select(StoredFile)
        .options(selectinload(StoredFile.links), selectinload(StoredFile.owner))
        .where(StoredFile.id == file_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def list_files(
    db: AsyncSession,
    *,
    owner: User | None = None,
) -> list[StoredFile]:
    stmt = select(StoredFile).options(selectinload(StoredFile.links), selectinload(StoredFile.owner)).order_by(StoredFile.created_at.desc())
    if owner is not None:
        stmt = stmt.where(StoredFile.owner_id == owner.id)
    result = await db.execute(stmt)
    return list(result.scalars())


async def delete_file(db: AsyncSession, file: StoredFile, *, owner: User) -> None:
    path = Path(file.storage_path)
    try:
        if path.exists():
            path.unlink()
        parent = path.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
        if file.session_id:
            await storage_service.cleanup_session(str(file.session_id))
    except OSError:
        pass

    await db.execute(delete(DownloadLink).where(DownloadLink.file_id == file.id))
    await db.delete(file)
    await db.commit()

    await increment_used_bytes(db, owner, -file.size)


async def get_link_by_short_code(db: AsyncSession, short_code: str) -> DownloadLink | None:
    result = await db.execute(select(DownloadLink).where(DownloadLink.short_code == short_code))
    return result.scalar_one_or_none()
