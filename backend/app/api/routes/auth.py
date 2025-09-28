from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from app.api import deps
from app.core.config import settings
from app.models.user import User
from app.schemas.auth import (
    MessageResponse,
    PasswordChangeRequest,
    TokenRequest,
    TokenResponse,
)
from app.schemas.user import RegistrationResponse, UserCreateRequest, UserResponse
from app.services import users as user_service
from app.utils.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegistrationResponse, status_code=status.HTTP_201_CREATED)
async def register_user(payload: UserCreateRequest, db: deps.DatabaseSessionDep) -> RegistrationResponse:
    await user_service.create_user(db, payload.email, payload.password, is_admin=False, is_active=False)
    return RegistrationResponse(message="Registration received. Await administrator approval.")


@router.post("/token", response_model=TokenResponse)
async def login_for_access_token(payload: TokenRequest, db: deps.DatabaseSessionDep) -> TokenResponse:
    email = payload.username.lower()
    user = await user_service.get_user_by_email(db, email)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending activation")

    expires_minutes = settings.access_token_expire_minutes
    if payload.remember_me:
        expires_minutes = max(expires_minutes, 60 * 24 * 30)
    token, expires_at = create_access_token(
        subject=str(user.id),
        expires_delta=timedelta(minutes=expires_minutes),
    )
    return TokenResponse(access_token=token, expires_at=expires_at, user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse)
async def read_current_user(current_user: User = Depends(deps.get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/password", response_model=MessageResponse)
async def change_password(
    payload: PasswordChangeRequest,
    db: deps.DatabaseSessionDep,
    current_user: User = Depends(deps.get_current_user),
) -> MessageResponse:
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if verify_password(payload.new_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different")

    await user_service.update_user(db, current_user, password=payload.new_password)
    return MessageResponse(message="Password updated successfully")
