from datetime import UTC, datetime

from fastapi import Depends, FastAPI, Form, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.config import get_settings
from app.database import Base, SessionLocal, engine, get_db
from app.models import Message, User
from app.security import create_user_session, delete_session, get_session_user, require_same_origin, verify_password
from app.websocket_manager import manager


settings = get_settings()
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
app = FastAPI(title=settings.app_name)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list or ["*"])
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data:; "
        "connect-src 'self' ws: wss:; "
        "base-uri 'none'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    return response


def serialize_message(message: Message) -> dict:
    return {
        "id": message.id,
        "body": None if message.deleted_at else message.body,
        "created_at": message.created_at.isoformat() if message.created_at else "",
        "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
        "user": {
            "id": message.user.id,
            "display_name": message.user.display_name,
            "buc_id": message.user.buc_id,
            "color": message.user.color,
        },
        "can_delete": False,
    }


def build_page_state(user: User | None, messages: list[Message]) -> dict:
    serialized_messages = [serialize_message(message) for message in messages]
    if user:
        for item, message in zip(serialized_messages, messages, strict=False):
            item["can_delete"] = user.role == "admin" or message.user_id == user.id
    return {
        "authenticated": bool(user),
        "user": None
        if not user
        else {
            "id": user.id,
            "display_name": user.display_name,
            "buc_id": user.buc_id,
            "role": user.role,
            "color": user.color,
        },
        "messages": serialized_messages,
    }


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    session_id = request.cookies.get(settings.session_cookie_name)
    return get_session_user(db, session_id)


def get_expected_origin(host: str, scheme: str, forwarded_proto: str | None = None) -> str:
    if forwarded_proto:
        normalized_scheme = forwarded_proto.split(",", maxsplit=1)[0].strip()
    elif scheme == "wss":
        normalized_scheme = "https"
    elif scheme == "ws":
        normalized_scheme = "http"
    else:
        normalized_scheme = scheme
    return f"{normalized_scheme}://{host}"


@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user)):
    messages: list[Message] = []
    if current_user:
        messages = db.scalars(
            select(Message)
            .options(joinedload(Message.user))
            .order_by(Message.created_at.asc())
            .limit(200)
        ).all()
    state = build_page_state(current_user, messages)
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "app_name": settings.app_name,
            "page_state": state,
        },
    )


@app.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


@app.post("/api/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    buc_id: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    require_same_origin(request)

    normalized_buc_id = buc_id.strip()
    if not normalized_buc_id or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="BUC ID and password are required")

    user = db.scalar(select(User).where(User.buc_id == normalized_buc_id).where(User.is_active.is_(True)))
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user_session = create_user_session(db, user)
    response = JSONResponse(
        {
            "ok": True,
            "user": {
                "id": user.id,
                "display_name": user.display_name,
                "buc_id": user.buc_id,
                "role": user.role,
                "color": user.color,
            },
        }
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=user_session.id,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.session_max_age_hours * 3600,
        path="/",
    )
    return response


@app.post("/api/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    require_same_origin(request)
    session_id = request.cookies.get(settings.session_cookie_name)
    delete_session(db, session_id)
    response = JSONResponse({"ok": True})
    response.delete_cookie(settings.session_cookie_name, path="/")
    return response


@app.delete("/api/messages/{message_id}")
async def delete_message(
    message_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user),
):
    require_same_origin(request)
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    message = db.scalar(select(Message).options(joinedload(Message.user)).where(Message.id == message_id))
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.deleted_at:
        return {"ok": True}
    if current_user.role != "admin" and message.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    message.deleted_at = datetime.now(UTC)
    message.deleted_by_user_id = current_user.id
    db.commit()
    db.refresh(message)

    payload = serialize_message(message)
    payload["can_delete"] = current_user.role == "admin" or message.user_id == current_user.id
    await manager.broadcast({"type": "message_deleted", "message": payload})
    return {"ok": True}


@app.websocket("/ws/chat")
async def chat_socket(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    expected_origin = get_expected_origin(
        host=websocket.headers.get("host", ""),
        scheme=websocket.url.scheme,
        forwarded_proto=websocket.headers.get("x-forwarded-proto"),
    )
    if origin and origin != expected_origin:
        await websocket.close(code=1008)
        return

    db = SessionLocal()
    session_id = websocket.cookies.get(settings.session_cookie_name)
    user = get_session_user(db, session_id)
    if not user:
        db.close()
        await websocket.close(code=1008)
        return

    await manager.connect(user.id, websocket)

    try:
        while True:
            payload = await websocket.receive_json()
            action = payload.get("action")

            if action != "send_message":
                continue

            body = str(payload.get("body", "")).replace("\x00", "").strip()
            if not body:
                continue
            if len(body) > 1000:
                await websocket.send_json({"type": "error", "detail": "Message is too long"})
                continue

            message = Message(user_id=user.id, body=body)
            db.add(message)
            db.commit()
            db.refresh(message)
            message = db.scalar(select(Message).options(joinedload(Message.user)).where(Message.id == message.id))

            broadcast_payload = serialize_message(message)
            broadcast_payload["can_delete"] = False
            await manager.broadcast({"type": "message_created", "message": broadcast_payload})
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user.id, websocket)
        db.close()
