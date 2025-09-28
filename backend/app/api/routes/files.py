from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from urllib.parse import quote

from app.api import deps
from app.db.session import get_db_session
from app.models.upload import FileStatus, StoredFile
from app.models.user import User
from app.schemas.file import (
    CreateLinkRequest,
    DownloadLinkDetail,
    DownloadLinkResponse,
    FileListResponse,
    FileResponse as FileSchema,
)
from app.services import uploads as upload_service
from app.services import users as user_service
from jwt import PyJWTError

from app.utils.security import decode_download_token, get_password_hash, verify_password

UNLIMITED_EXPIRY_DELTA = timedelta(days=365 * 100)
UNLIMITED_FLAG_THRESHOLD = timedelta(days=365 * 50)

router = APIRouter(prefix="/files", tags=["files"])
public_router = APIRouter(tags=["download"])


async def _get_file_or_404(db: AsyncSession, file_id: uuid.UUID) -> StoredFile:
    file = await upload_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return file


def _assert_file_access(file: StoredFile, user: User) -> None:
    if file.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")


# helper


def _link_to_schema(file: StoredFile, link) -> DownloadLinkDetail:
    reference_created_at = link.created_at or datetime.now(timezone.utc)
    never_expires = False
    if link.expires_at:
        never_expires = (link.expires_at - reference_created_at) >= UNLIMITED_FLAG_THRESHOLD
    return DownloadLinkDetail(
        id=link.id,
        url=f"/d/{file.id}?token={link.token}",
        expires_at=link.expires_at,
        download_count=(link.download_count or 0),
        never_expires=never_expires,
        require_download_page=link.require_download_page,
        has_password=bool(link.password_hash),
        short_url=f"/s/{link.short_code}" if link.short_code else None,
    )


def _file_to_schema(file: StoredFile) -> FileSchema:
    return FileSchema(
        id=file.id,
        filename=file.filename,
        size=file.size,
        mime_type=file.mime_type,
        sha256=file.sha256,
        status=file.status.value,
        created_at=file.created_at,
        owner_id=file.owner_id,
        owner_email=getattr(file.owner, "email", None),
        links=[_link_to_schema(file, link) for link in file.links],
    )


@router.get("/", response_model=FileListResponse)
async def list_files(
    owner_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(deps.get_current_user),
) -> FileListResponse:
    target_owner: User | None = None
    if owner_id is not None:
        if not current_user.is_admin and owner_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        target_owner = await user_service.get_user_by_id(db, owner_id)
        if target_owner is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    elif not current_user.is_admin:
        target_owner = current_user

    files = await upload_service.list_files(db, owner=target_owner)
    return FileListResponse(files=[_file_to_schema(file) for file in files])


@router.get("/{file_id}", response_model=FileSchema)
async def get_file_metadata(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(deps.get_current_user),
) -> FileSchema:
    stored_file = await _get_file_or_404(db, file_id)
    _assert_file_access(stored_file, current_user)
    return _file_to_schema(stored_file)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(deps.get_current_user),
) -> Response:
    stored_file = await _get_file_or_404(db, file_id)
    _assert_file_access(stored_file, current_user)
    owner_user = await user_service.get_user_by_id(db, stored_file.owner_id)
    if owner_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Owner not found")
    await upload_service.delete_file(db, stored_file, owner=owner_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{file_id}/links", response_model=list[DownloadLinkDetail])
async def list_download_links(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(deps.get_current_user),
) -> list[DownloadLinkDetail]:
    stored_file = await _get_file_or_404(db, file_id)
    _assert_file_access(stored_file, current_user)
    return [_link_to_schema(stored_file, link) for link in stored_file.links]


@router.post("/{file_id}/links", response_model=DownloadLinkResponse)
async def create_download_link(
    file_id: uuid.UUID,
    payload: CreateLinkRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(deps.get_current_user),
) -> DownloadLinkResponse:
    stored_file = await _get_file_or_404(db, file_id)
    _assert_file_access(stored_file, current_user)
    if stored_file.status != FileStatus.READY:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="File not ready")

    now = datetime.now(timezone.utc)
    record_expires_at: datetime
    if payload.no_expiry:
        record_expires_at = now + UNLIMITED_EXPIRY_DELTA
    elif payload.expires_at is not None:
        record_expires_at = payload.expires_at
        if record_expires_at.tzinfo is None:
            record_expires_at = record_expires_at.replace(tzinfo=timezone.utc)
        if record_expires_at <= now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Expiration must be in the future")
    else:
        minutes = payload.expires_in_minutes or 60
        record_expires_at = now + timedelta(minutes=minutes)

    token, _ = await upload_service.issue_download_token(
        stored_file,
        record_expires_at,
        False,
    )
    password_hash = None
    if payload.password:
        password_hash = get_password_hash(payload.password).encode()

    short_code = None
    if payload.create_short_link:
        short_code = await upload_service.generate_unique_short_code(db)

    record = await upload_service.create_download_link_record(
        db=db,
        file=stored_file,
        token=token,
        expires_at=record_expires_at,
        one_time=False,
        password_hash=password_hash,
        require_download_page=payload.require_download_page,
        short_code=short_code,
    )

    url = f"/d/{stored_file.id}?token={token}"
    never_expires = payload.no_expiry or ((record.expires_at - now) >= UNLIMITED_FLAG_THRESHOLD)

    return DownloadLinkResponse(
        id=record.id,
        url=url,
        expires_at=record.expires_at,
        download_count=record.download_count or 0,
        never_expires=never_expires,
        require_download_page=record.require_download_page,
        has_password=bool(record.password_hash),
        short_url=f"/s/{record.short_code}" if record.short_code else None,
    )


@router.delete("/{file_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_download_link(
    file_id: uuid.UUID,
    link_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(deps.get_current_user),
) -> Response:
    stored_file = await _get_file_or_404(db, file_id)
    _assert_file_access(stored_file, current_user)
    link = next((l for l in stored_file.links if l.id == link_id), None)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    await db.delete(link)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@public_router.get("/download/{token}")
async def download_by_token(
    token: str,
    db: AsyncSession = Depends(get_db_session),
    password: str | None = Query(default=None),
) -> FileResponse:
    try:
        payload = decode_download_token(token)
    except PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token") from exc
    file_id = payload.get("fid")
    if not file_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")

    stored_file = await _get_file_or_404(db, uuid.UUID(file_id))
    link = next((l for l in stored_file.links if l.token == token), None)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")

    if not link.is_enabled:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link disabled")

    if link.expires_at and datetime.now(timezone.utc) > link.expires_at:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link expired")

    if link.password_hash:
        if not password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Password required")
        if not verify_password(password, link.password_hash.decode()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    download_count = link.download_count or 0
    if link.one_time and download_count >= 1:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Link exhausted")

    link.download_count = download_count + 1
    if link.one_time:
        link.is_enabled = False

    await db.commit()

    file_path = Path(stored_file.storage_path)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing")

    ascii_filename = stored_file.filename.encode('ascii', 'ignore').decode('ascii') or 'download'
    content_disposition = f"attachment; filename=\"{ascii_filename}\""
    if ascii_filename != stored_file.filename:
        content_disposition += f"; filename*=UTF-8''{quote(stored_file.filename)}"

    headers = {
        "X-Accel-Redirect": f"/_protected/{stored_file.id}/data",
        "Content-Disposition": content_disposition,
    }
    return FileResponse(
        path=file_path,
        media_type=stored_file.mime_type or "application/octet-stream",
        filename=stored_file.filename,
        headers=headers,
    )


@public_router.get("/s/{short_code}")
async def download_by_short_code(
    short_code: str,
    db: AsyncSession = Depends(get_db_session),
    password: str | None = Query(default=None),
) -> FileResponse:
    link = await upload_service.get_link_by_short_code(db, short_code)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found")
    if link.require_download_page or link.password_hash:
        stored_file = await upload_service.get_file_by_id(db, link.file_id)
        if not stored_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        target = f"/share-download/{stored_file.id}?token={link.token}"
        if stored_file.filename:
            target += f"&name={quote(stored_file.filename)}"
        return RedirectResponse(url=target, status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    return await download_by_token(token=link.token, db=db, password=password)


@public_router.get("/d/{file_id}")
async def download_with_query(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    token: str = Query(...),
    password: str | None = Query(default=None),
) -> FileResponse:
    return await download_by_token(token=token, password=password, db=db)
