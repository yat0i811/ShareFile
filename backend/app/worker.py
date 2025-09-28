from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from celery import Celery
from sqlalchemy import select

from app.core.config import settings
from app.db.session import async_session_factory
from app.models.upload import FileStatus, StoredFile, UploadChunk, UploadSession, UploadStatus
from app.models.user import User
from app.services.storage import storage_service
from app.services.users import increment_used_bytes

logger = logging.getLogger(__name__)

celery_app = Celery(
    "share_storage",
    broker=settings.celery_broker,
    backend=settings.celery_backend,
)
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])


async def _finalize_upload(session_id: uuid.UUID, file_id: uuid.UUID) -> None:
    async with async_session_factory() as db:
        session: UploadSession | None = await db.get(UploadSession, session_id)
        if session is None:
            logger.error("Upload session %s not found", session_id)
            return
        stored_file: StoredFile | None = await db.get(StoredFile, file_id)
        if stored_file is None:
            logger.error("Stored file %s not found", file_id)
            return
        owner: User | None = await db.get(User, session.owner_id)
        if owner is None:
            logger.error("Owner %s not found for session %s", session.owner_id, session_id)
            return

        chunk_indexes_stmt = select(UploadChunk.index).where(UploadChunk.session_id == session_id)
        result = await db.execute(chunk_indexes_stmt)
        received = sorted(idx for (idx,) in result)
        if len(received) != session.total_chunks or received != list(range(session.total_chunks)):
            logger.error("Missing chunks for session %s", session_id)
            session.status = UploadStatus.FAILED
            stored_file.status = FileStatus.ERROR
            await db.commit()
            return

        target_path = Path(stored_file.storage_path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        merged_size = await storage_service.merge_chunks(str(session_id), session.total_chunks, target_path)

        sha256 = await storage_service.compute_sha256(target_path)
        if sha256 != session.file_sha256:
            logger.error(
                "Hash mismatch for session %s expected=%s actual=%s",
                session_id,
                session.file_sha256,
                sha256,
            )
            stored_file.status = FileStatus.ERROR
            session.status = UploadStatus.FAILED
            await db.commit()
            return

        if owner.quota_bytes is not None and owner.used_bytes + merged_size > owner.quota_bytes:
            logger.error("Quota exceeded for user %s while finalizing file %s", owner.id, file_id)
            stored_file.status = FileStatus.ERROR
            session.status = UploadStatus.FAILED
            await db.commit()
            await storage_service.cleanup_session(str(session_id))
            return

        stored_file.status = FileStatus.READY
        stored_file.completed_at = datetime.now(timezone.utc)
        stored_file.size = merged_size
        session.status = UploadStatus.COMPLETED
        session.finalized_at = datetime.now(timezone.utc)
        await db.commit()

        await increment_used_bytes(db, owner, merged_size)

        await storage_service.cleanup_session(str(session_id))


@celery_app.task(name="finalize_upload")
def finalize_upload_task(session_id: str, file_id: str) -> None:
    asyncio.run(_finalize_upload(uuid.UUID(session_id), uuid.UUID(file_id)))
