from __future__ import annotations

import enum
import uuid
from datetime import datetime, timedelta, timezone

from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.base import Base

if TYPE_CHECKING:  # pragma: no cover - for type checkers only
    from app.models.user import User


class UploadStatus(str, enum.Enum):
    INIT = "init"
    UPLOADING = "uploading"
    FINALIZING = "finalizing"
    COMPLETED = "completed"
    EXPIRED = "expired"
    FAILED = "failed"


class FileStatus(str, enum.Enum):
    PENDING = "pending"
    READY = "ready"
    ERROR = "error"


class UploadSession(Base):
    __tablename__ = "upload_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    chunk_size: Mapped[int] = mapped_column(Integer, nullable=False)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(128), nullable=False)

    status: Mapped[UploadStatus] = mapped_column(Enum(UploadStatus), default=UploadStatus.INIT, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    upload_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    owner: Mapped["User"] = relationship("User", back_populates="upload_sessions")
    file: Mapped[StoredFile | None] = relationship(
        "StoredFile", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    chunks: Mapped[list[UploadChunk]] = relationship(
        "UploadChunk", back_populates="session", cascade="all, delete-orphan", lazy="selectin"
    )

    @staticmethod
    def build_expiration(now: datetime | None = None) -> datetime:
        now = now or datetime.now(timezone.utc)
        return now + timedelta(minutes=settings.session_ttl_minutes)


class UploadChunk(Base):
    __tablename__ = "upload_chunks"
    __table_args__ = (
        UniqueConstraint("session_id", "index", name="uq_chunk_session_index"),
        CheckConstraint("size >= 0", name="ck_chunk_size_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("upload_sessions.id", ondelete="CASCADE"), nullable=False
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum: Mapped[str] = mapped_column(String(128), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    stored_path: Mapped[str] = mapped_column(String(1024), nullable=False)

    session: Mapped[UploadSession] = relationship("UploadSession", back_populates="chunks")


class StoredFile(Base):
    __tablename__ = "stored_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("upload_sessions.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[FileStatus] = mapped_column(Enum(FileStatus), default=FileStatus.PENDING, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    owner: Mapped["User"] = relationship("User", back_populates="files")
    session: Mapped[UploadSession | None] = relationship("UploadSession", back_populates="file")
    links: Mapped[list[DownloadLink]] = relationship(
        "DownloadLink", back_populates="file", cascade="all, delete-orphan"
    )


class DownloadLink(Base):
    __tablename__ = "download_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stored_files.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    one_time: Mapped[bool] = mapped_column(Boolean, default=False)
    download_count: Mapped[int] = mapped_column("remaining_downloads", Integer, nullable=False, default=0)
    password_hash: Mapped[bytes | None] = mapped_column(LargeBinary)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_download_page: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    short_code: Mapped[str | None] = mapped_column(String(32), unique=True)

    file: Mapped[StoredFile] = relationship("StoredFile", back_populates="links")
