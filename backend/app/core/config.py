from __future__ import annotations

from functools import cached_property, lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_name: str = "ShareFile"
    api_prefix: str = "/api"

    database_url: str = Field(
        default="postgresql+asyncpg://share_storage:share_storage@db:5432/share_storage",
        description="SQLAlchemy async database URL",
    )
    redis_url: str = Field(default="redis://redis:6379/0", description="Redis connection URL")

    storage_root: Path = Field(
        default=Path(__file__).resolve().parents[3] / "Storage",
        description="Base directory for file storage",
    )
    tmp_dir_name: str = Field(default="uploads/tmp")
    files_dir_name: str = Field(default="files")

    max_chunk_size: int = Field(default=16 * 1024 * 1024, ge=1)
    default_chunk_size: int = Field(default=8 * 1024 * 1024, ge=1)

    session_ttl_minutes: int = Field(default=60 * 6, ge=5)
    session_cleanup_minutes: int = Field(default=60 * 24, ge=10)

    jwt_secret: str = Field(default="change-me", min_length=10)
    jwt_algorithm: str = Field(default="HS256")
    access_token_expire_minutes: int = Field(default=60 * 12)

    admin_email: str = Field(default="admin@example.com")
    admin_password: str | None = Field(default=None)
    admin_password_hash: str = Field(
        default="$2b$12$dl8Ne6PFc.CD1gVYLRNvJeXp9jR8GStlMsJGcZ4opecQcsao4s46y",
        description="bcrypt hash for default admin password 'changeme'",
    )

    celery_broker_url: str | None = None
    celery_result_backend: str | None = None

    cors_allowed_origins: List[str] = Field(default_factory=lambda: ["*"])

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    @field_validator("storage_root", mode="before")
    @classmethod
    def _build_storage_root(cls, value: Path | str) -> Path:
        return Path(value)

    @property
    def tmp_dir(self) -> Path:
        return self.storage_root / self.tmp_dir_name

    @property
    def files_dir(self) -> Path:
        return self.storage_root / self.files_dir_name

    @property
    def celery_broker(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def celery_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @cached_property
    def effective_admin_password_hash(self) -> str:
        if self.admin_password:
            from app.utils.security import get_password_hash

            return get_password_hash(self.admin_password)
        return self.admin_password_hash


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
