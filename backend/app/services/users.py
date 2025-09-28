from __future__ import annotations

import uuid
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.security import get_password_hash


async def create_user(
    db: AsyncSession,
    email: str,
    password: str,
    *,
    is_admin: bool = False,
    is_active: bool | None = None,
    quota_bytes: int | None = None,
) -> User:
    user = User(
        email=email.lower(),
        password_hash=get_password_hash(password),
        is_admin=is_admin,
        is_active=is_active if is_active is not None else is_admin,
        quota_bytes=quota_bytes,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered") from exc
    await db.refresh(user)
    return user


async def ensure_admin_user(
    db: AsyncSession,
    *,
    email: str,
    password_hash: str,
) -> None:
    stmt = select(User).where(User.email == email.lower())
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        db.add(
            User(
                email=email.lower(),
                password_hash=password_hash,
                is_admin=True,
                is_active=True,
            )
        )
        await db.commit()
    elif not user.is_admin:
        user.is_admin = True
        user.is_active = True
        if password_hash:
            user.password_hash = password_hash
        await db.commit()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars())


_SENTINEL = object()


async def update_user(
    db: AsyncSession,
    user: User,
    *,
    is_active: bool | None = None,
    quota_bytes: int | object = _SENTINEL,
    password: str | None = None,
) -> User:
    if is_active is not None:
        user.is_active = is_active
    if quota_bytes is not _SENTINEL:
        user.quota_bytes = quota_bytes  # type: ignore[assignment]
    if password:
        user.password_hash = get_password_hash(password)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user: User) -> None:
    await db.delete(user)
    await db.commit()


async def increment_used_bytes(db: AsyncSession, user: User, delta: int) -> None:
    user.used_bytes = max(0, user.used_bytes + delta)
    await db.commit()
    await db.refresh(user)


async def bulk_update_used_bytes(db: AsyncSession, users: Iterable[User]) -> None:
    for user in users:
        user.used_bytes = max(0, user.used_bytes)
    await db.commit()
