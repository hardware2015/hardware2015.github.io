from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Session as UserSession
from app.models import User


password_hasher = PasswordHasher()
settings = get_settings()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def build_session_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(hours=settings.session_max_age_hours)


def create_user_session(db: Session, user: User) -> UserSession:
    session = UserSession(
        id=token_urlsafe(32),
        user_id=user.id,
        expires_at=build_session_expiry(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session_user(db: Session, session_id: str | None) -> User | None:
    if not session_id:
        return None

    user_session = db.scalar(
        select(UserSession)
        .where(UserSession.id == session_id)
        .where(UserSession.expires_at > datetime.now(UTC))
    )
    if not user_session:
        return None

    user = db.scalar(select(User).where(User.id == user_session.user_id).where(User.is_active.is_(True)))
    return user


def delete_session(db: Session, session_id: str | None) -> None:
    if not session_id:
        return
    user_session = db.get(UserSession, session_id)
    if user_session:
        db.delete(user_session)
        db.commit()


def require_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    expected_origin = f"{request.url.scheme}://{request.headers.get('host', '')}"

    if origin:
        if origin != expected_origin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid origin")
        return

    if referer and not referer.startswith(expected_origin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid referer")
