from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr


class UserCreateRequest(UserBase):
    password: str = Field(min_length=8)


class UserAdminCreateRequest(UserCreateRequest):
    is_admin: bool = False
    quota_bytes: int | None = Field(default=None, ge=0)
    is_active: bool = False


class UserUpdateRequest(BaseModel):
    is_active: bool | None = None
    quota_bytes: int | None = Field(default=None, ge=0)
    password: str | None = Field(default=None, min_length=8)


class UserResponse(UserBase):
    id: uuid.UUID
    is_admin: bool
    is_active: bool
    quota_bytes: int | None
    used_bytes: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    users: list[UserResponse]


class RegistrationResponse(BaseModel):
    message: str
