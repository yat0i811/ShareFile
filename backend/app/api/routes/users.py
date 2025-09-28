from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api import deps
from app.models.user import User
from app.schemas.user import (
    UserAdminCreateRequest,
    UserListResponse,
    UserResponse,
    UserUpdateRequest,
)
from app.services import users as user_service

router = APIRouter(prefix="/admin/users", tags=["admin:users"])


@router.get("/", response_model=UserListResponse)
async def list_users(
    db: deps.DatabaseSessionDep,
    _: User = Depends(deps.get_current_admin),
) -> UserListResponse:
    users = await user_service.list_users(db)
    return UserListResponse(users=[UserResponse.model_validate(user) for user in users])


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserAdminCreateRequest,
    db: deps.DatabaseSessionDep,
    _: User = Depends(deps.get_current_admin),
) -> UserResponse:
    user = await user_service.create_user(
        db,
        email=payload.email,
        password=payload.password,
        is_admin=payload.is_admin,
        is_active=payload.is_active,
        quota_bytes=payload.quota_bytes,
    )
    return UserResponse.model_validate(user)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateRequest,
    db: deps.DatabaseSessionDep,
    current_admin: User = Depends(deps.get_current_admin),
) -> UserResponse:
    user = await user_service.get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_admin.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate yourself")

    update_kwargs: dict[str, object] = {}
    if payload.is_active is not None:
        update_kwargs["is_active"] = payload.is_active
    if "quota_bytes" in payload.model_fields_set:
        update_kwargs["quota_bytes"] = payload.quota_bytes
    if payload.password:
        update_kwargs["password"] = payload.password

    updated = await user_service.update_user(
        db,
        user,
        **update_kwargs,
    )
    return UserResponse.model_validate(updated)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: deps.DatabaseSessionDep,
    current_admin: User = Depends(deps.get_current_admin),
) -> Response:
    user = await user_service.get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    await user_service.delete_user(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
