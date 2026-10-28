from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, validator
from passlib.context import CryptContext
import jwt  # [Gate S1] python-jose(保守停止・未修正の脆弱性あり)から PyJWT へ
from app.core.password_policy import PasswordPolicyError, validate_password
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Literal, Union
import hashlib
import hmac
import secrets
import uuid
import logging

from app.core.database import get_db
from app.core.config import settings
from app.core.auth import (
    auth_manager, get_current_active_user, get_current_session_id, get_current_user_optional, get_current_user_or_guest,
)
from app.models.models import User, UserSession
from app.utils.rate_limiter import check_rate_limit
from app.services.audit_service import record_audit_event
from app.services import challenge, incident, login_alerts, mfa, threat_guard

router = APIRouter()

logger = logging.getLogger("travelcanvas.auth")

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/v1/auth"
# [Gate S2] 直前の refresh token のハッシュと入れ替えた時刻(UserSession.device_info の中。migration を避ける)。
# 同じブラウザの複数タブが同時に refresh した時、この秒数の間だけ直前の token を「同時の正規の要求」として扱う。
_REFRESH_PREV_KEY = "_refresh_prev_hash"
_REFRESH_ROTATED_AT_KEY = "_refresh_rotated_at"
REFRESH_REUSE_GRACE_SECONDS = 20
# [Gate S11] 多要素認証を通った時刻(app/services/mfa.py)も内部の値として一覧に出さない
_INTERNAL_DEVICE_INFO_KEYS = (_REFRESH_PREV_KEY, _REFRESH_ROTATED_AT_KEY, mfa.SESSION_MFA_KEY)

# パスワードハッシュ化
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Pydantic models


class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    user_type: str
    is_verified: bool

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class MfaChallengeResponse(BaseModel):
    """[Gate S11] パスワードは正しいが、多要素認証(認証アプリの確認コード)がまだの時の POST /auth/login の応答。
    この時点ではセッションも cookie も作らない。画面は mfa_token と確認コードを POST /auth/mfa/verify へ送る。"""
    mfa_required: Literal[True] = True
    mfa_token: str
    methods: List[str]
    expires_in: int


class GuestSessionResponse(BaseModel):
    """[Gate #35] POST /auth/guest の応答。ゲストはusername/emailを持たない
    ためTokenResponse/UserResponseは使わず専用モデルとする。"""
    access_token: str
    token_type: str
    user_type: str
    guest_id: str
    expires_in_hours: int


class GuestUpgradeRequest(BaseModel):
    """[Gate #35] POST /auth/guest/upgrade の入力。UserRegisterと同じ形だが、
    「新規作成」ではなく「既存ゲストuser行の昇格」であることを明示するため
    別モデルとして定義する。"""
    username: str
    email: EmailStr
    password: str


class UserDetailResponse(BaseModel):
    """[Gate #20] GET/PUT /me用の詳細ユーザー情報。preferences(JSON)を含む。"""
    id: str
    username: str
    email: str
    user_type: str
    is_verified: bool
    is_active: bool
    preferences: Optional[Dict[str, Any]] = None
    created_at: datetime

    # [Gate #27] User.idはDB上UUID型カラムのため、ORMオブジェクトから直接
    # 変換するとPydantic v2ではstrへ暗黙変換されずResponseValidationError
    # (実質500エラー)になっていた実バグの修正。GET/PUT /auth/meを実際に
    # 呼び出すpytestで発覚した。
    @validator('id', pre=True)
    def _stringify_id(cls, v):
        return str(v)

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    """[Gate #20] プロフィール更新スキーマ。渡されたフィールドのみ更新する。
    [Gate S2] メールアドレスを変える時は current_password(再認証)が必要。"""
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    preferences: Optional[Dict[str, Any]] = None
    current_password: Optional[str] = None


class PasswordChange(BaseModel):
    """[Gate #21] パスワード変更スキーマ。
    [Gate S2] 規則の検査は登録・昇格と同じ _enforce_password_policy で行う(以前はここだけ8文字の検査があった)。"""
    current_password: str
    new_password: str


class SessionInfo(BaseModel):
    """[Gate #28] セッション(device/session)一覧表示用
    [Gate S9] 端末の名前(ブラウザ / OS)・丸めた接続元・最終利用を追加(設定の「ログイン中の端末」)"""
    id: str
    ip_address: Optional[str] = None
    device_info: Optional[Dict[str, Any]] = None
    created_at: datetime
    expires_at: datetime
    is_current: bool
    device_label: str = "不明な端末"
    network_label: Optional[str] = None
    last_active_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ユーティリティ関数


def _enforce_password_policy(password: str, *, email: Optional[str] = None, username: Optional[str] = None,
                             extra_banned=()) -> None:
    """[Gate S2] 登録・昇格・変更で同じ規則を強制する(app/core/password_policy.py)。400 と日本語の理由を返す。"""
    try:
        validate_password(password, email=email, username=username, extra_banned=extra_banned)
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: Optional[str]) -> bool:
    # [Gate G10-Q] パスワードの無い利用者(ゲスト等、hashed_password が NULL)は常に不一致
    if not hashed_password:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


# ===== [Gate #28] refresh token ユーティリティ =====
# refresh tokenは "{session_id}.{secret}" という不透明な文字列としてhttpOnly
# cookieでのみ発行する(レスポンスJSONには含めない/localStorageにも置かない)。
# DBにはsecretの平文ではなくSHA-256ハッシュ(session_token列)のみを保存し、
# 使用の度に新しいsecretへローテーションする。ハッシュが一致しない
# (=既にローテーション済みの古いtokenが再送されてきた)場合は盗用の兆候と
# みなし、そのセッションを即座に失効させる。

def _within_refresh_grace(session: UserSession, presented_hash: str, now: datetime) -> bool:
    info = session.device_info or {}
    prev = info.get(_REFRESH_PREV_KEY)
    rotated_at = info.get(_REFRESH_ROTATED_AT_KEY)
    if not isinstance(prev, str) or not isinstance(rotated_at, str):
        return False
    if not hmac.compare_digest(prev, presented_hash):
        return False
    try:
        rotated = datetime.fromisoformat(rotated_at)
    except ValueError:
        return False
    return timedelta(0) <= now - rotated <= timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS)


def _public_device_info(info: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """[Gate S2] セッション一覧に内部の値(直前の token のハッシュ等)を出さない。"""
    if not info:
        return info
    return {k: v for k, v in info.items() if k not in _INTERNAL_DEVICE_INFO_KEYS}


def _hash_refresh_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _generate_refresh_secret() -> str:
    return secrets.token_urlsafe(32)


def _parse_refresh_cookie(raw: str):
    if not raw or "." not in raw:
        return None, None
    session_id, _, secret = raw.partition(".")
    return session_id, secret


def _set_refresh_cookie(response: Response, value: str) -> None:
    """[Gate S4] 更新鍵の cookie。以前は APP_ENV が "production" ちょうどの時だけ Secure を付けており、
    prod・staging では平文の HTTP でも送られ得た。本番相当の環境(settings.is_production)では必ず付ける。"""
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=value,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )


def _allowed_origins() -> List[str]:
    # [Gate H1] CORS と同じ一覧(TC_PUBLIC_HOSTS の :4173 を含む)
    return settings.cors_allowed_origins


def _refuse_if_signup_closed() -> None:
    """[Gate S8] 警戒モードで新規登録・ゲスト開始を止めている間は 503(既存の利用者のログインは止めない)。"""
    if incident.signup_closed():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="現在、新規登録とゲストの開始を一時停止しています。しばらくしてから再試行してください。",
            headers={"Retry-After": "600"},
        )


def _reject_cross_site(request: Request) -> None:
    """[Gate S4] cookie だけで本人と分かる操作(更新・ログアウト)を、許可していない別のサイトから
    呼ばせない(CSRF 対策)。SameSite=Lax に加え、ブラウザが付ける Origin / Sec-Fetch-Site を確かめる。
    Origin の無い要求(curl・試験・同じ画面からの GET 等)はブラウザ外なので通す。"""
    origin = request.headers.get("origin")
    site = (request.headers.get("sec-fetch-site") or "").lower()
    if origin and origin != "null":
        host = request.headers.get("host", "")
        same_host = origin.split("://", 1)[-1] == host
        if origin in _allowed_origins() or same_host:
            return
    elif not origin and site != "cross-site":
        return
    record_audit_event(action="cross_site_request_blocked", resource_type="auth",
                       ip_address=request.client.host if request.client else None,
                       details={"path": request.url.path})
    threat_guard.signal(request, "cross_site_blocked")  # [Gate S6]
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="この操作は許可されていない場所からは行えません")


def _session_from_refresh_cookie(request: Request, db: Session) -> Optional[UserSession]:
    """[Gate S4] cookie の更新鍵が今のものと一致する時だけ、そのセッションを返す(ログアウト用。入れ替えはしない)。"""
    session_id, secret = _parse_refresh_cookie(request.cookies.get(REFRESH_COOKIE_NAME) or "")
    if not session_id or not secret:
        return None
    try:
        session_uuid = uuid.UUID(str(session_id))
    except ValueError:
        return None
    session = db.query(UserSession).filter(UserSession.id == session_uuid).first()
    if session is None or not session.session_token:
        return None
    if not hmac.compare_digest(session.session_token, _hash_refresh_secret(secret)):
        return None
    return session


def _user_response(user: User) -> UserResponse:
    """[Gate G10-Q] 応答の利用者。DB では名前・メールが NULL を許すため(ゲストからの昇格の途中など)、
    以前は None のまま UserResponse に渡して検証の誤り(500)になり得た。空の文字列にそろえる。"""
    return UserResponse(
        id=str(user.id),
        username=user.username or "",
        email=user.email or "",
        user_type=str(user.user_type or "registered"),
        is_verified=bool(user.is_verified),
    )


def _access_token_for(user: User, session_id: Union[str, uuid.UUID]) -> str:
    return create_access_token(
        data={"sub": str(user.id), "username": user.username, "session_id": str(session_id)}
    )


@router.post("/guest", response_model=GuestSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_guest_session(
    request: Request,
    db: Session = Depends(get_db),
):
    """[Gate #35] ログイン不要でプラン作成・閲覧ができるゲストセッションを発行する。

    ゲストは実際に`users`テーブルへ1行作成する(username/email/hashed_passwordは
    全てNULL、user_type='guest')。これはtravel_plans.user_idがusers.idへの
    外部キーであり、DBスキーマを一切変更せずに既存の所有権チェック
    (TravelPlan.user_id == current_user.id)をそのまま再利用するための設計。
    このuser行は`/auth/guest/upgrade`で正規アカウントへその場で昇格するか、
    settings.GUEST_TOKEN_EXPIRE_HOURS経過後は誰にも到達不能な孤児行として
    残る(定期クリーンアップは別Gateで対応。本パッチのスコープ外)。
    """
    challenge.require(request, "guest")  # [Gate S7] 怪しい接続元には計算の確認を求める
    _refuse_if_signup_closed()  # [Gate S8]
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"guest:{client_ip}", settings.RATE_LIMIT_GUEST, 3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="ゲストセッションの発行回数が上限に達しました。しばらく待ってから再試行してください。"
        )

    try:
        guest_user = User(
            username=None,
            email=None,
            hashed_password=None,
            user_type="guest",
            is_active=True,
            is_verified=False,
        )
        db.add(guest_user)
        db.commit()
        db.refresh(guest_user)

        guest_token = auth_manager.create_guest_token(str(guest_user.id))

        return GuestSessionResponse(
            access_token=guest_token,
            token_type="bearer",
            user_type="guest",
            guest_id=str(guest_user.id),
            expires_in_hours=settings.GUEST_TOKEN_EXPIRE_HOURS,
        )

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        request_id = getattr(request.state, "request_id", "unknown")
        logger.exception(f"[{request_id}] guest session creation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ゲストセッションの作成に失敗しました。しばらくしてから再試行してください。"
        )


@router.post("/guest/upgrade", response_model=TokenResponse)
async def upgrade_guest_to_user(
    upgrade_data: GuestUpgradeRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user_or_guest),
    db: Session = Depends(get_db),
):
    """[Gate #35] ゲストを正規アカウントへ昇格する。

    新規userを作るのではなく、ゲストが既に持っている`users`行を
    その場でupdateする。travel_plans.user_idは変更しないため、
    ゲスト中に作成した全プランの所有権は自動的にそのまま正規
    アカウントへ引き継がれる(FK参照先の行自体が昇格するため)。
    """
    if current_user.user_type != "guest":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="この操作はゲストセッションでのみ実行できます。"
        )

    challenge.require(request, "guest_upgrade")  # [Gate S7]
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"guest_upgrade:{client_ip}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )
    _enforce_password_policy(upgrade_data.password, email=upgrade_data.email, username=upgrade_data.username)

    try:
        existing_user = db.query(User).filter(
            (User.email == upgrade_data.email) |
            (User.username == upgrade_data.username)
        ).first()

        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="このメールアドレスまたはユーザー名は既に使用されています"
            )

        db_user = db.query(User).filter(User.id == current_user.id).first()
        if not db_user or db_user.user_type != "guest":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ゲストセッションが見つかりません。"
            )

        db_user.username = upgrade_data.username
        db_user.email = upgrade_data.email
        db_user.hashed_password = hash_password(upgrade_data.password)
        db_user.user_type = "registered"
        db_user.is_verified = False

        db.commit()
        db.refresh(db_user)

        secret = _generate_refresh_secret()
        session = auth_manager.create_session(
            user_id=db_user.id,
            refresh_token_hash=_hash_refresh_secret(secret),
            ip_address=client_ip,
            device_info=login_alerts.session_device_info(request.headers.get("user-agent")),  # [Gate S9]
            db=db,
        )
        _set_refresh_cookie(response, f"{session.id}.{secret}")
        access_token = _access_token_for(db_user, session.id)

        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            user=_user_response(db_user)
        )

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        request_id = getattr(request.state, "request_id", "unknown")
        logger.exception(f"[{request_id}] guest upgrade failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="アカウント昇格に失敗しました。しばらくしてから再試行してください。"
        )


@router.post("/register", response_model=TokenResponse)
async def register(
    user_data: UserRegister,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """新規ユーザー登録"""

    challenge.require(request, "register")  # [Gate S7]
    _refuse_if_signup_closed()  # [Gate S8]
    # [Gate #28] IPベースのレート制限。ログインと同じ閾値を流用する。
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"register:{client_ip}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登録試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )
    _enforce_password_policy(user_data.password, email=user_data.email, username=user_data.username)

    try:
        # ユーザー重複チェック
        existing_user = db.query(User).filter(
            (User.email == user_data.email) |
            (User.username == user_data.username)
        ).first()

        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="このメールアドレスまたはユーザー名は既に使用されています"
            )

        # パスワードハッシュ化
        hashed_password = hash_password(user_data.password)

        # 新規ユーザー作成
        new_user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=hashed_password,
            user_type="registered",
            is_active=True,
            is_verified=False
        )

        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        # [Gate #28] セッションを作成し、refresh tokenをhttpOnly cookieで発行する。
        secret = _generate_refresh_secret()
        session = auth_manager.create_session(
            user_id=new_user.id,
            refresh_token_hash=_hash_refresh_secret(secret),
            ip_address=client_ip,
            device_info=login_alerts.session_device_info(request.headers.get("user-agent")),  # [Gate S9]
            db=db,
        )
        _set_refresh_cookie(response, f"{session.id}.{secret}")
        access_token = _access_token_for(new_user, session.id)

        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            user=_user_response(new_user)
        )

    except HTTPException:
        raise
    except Exception:
        # [Gate #28] 内部例外の文字列(SQL文言等)をそのままクライアントへ返す
        # と情報漏洩になるため、汎用メッセージのみを返し、詳細はサーバー
        # ログ(request_id付き)にのみ記録する。
        request_id = getattr(request.state, "request_id", "unknown")
        logger.exception(f"[{request_id}] registration failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="登録に失敗しました。しばらくしてから再試行してください。"
        )


def complete_login(db: Session, user: User, request: Request, response: Response, *, mfa_verified: bool,
                   mfa_method: Optional[str] = None) -> TokenResponse:
    """ログインの最後(セッション・cookie・アクセストークン・新しい端末の通知・監査)。
    [Gate S11] パスワードだけのログインと、多要素認証の2段目(POST /auth/mfa/verify)の両方から使う。"""
    client_ip = request.client.host if request.client else "unknown"
    # [Gate #28] セッションを作成し、refresh tokenをhttpOnly cookieで発行する。
    secret = _generate_refresh_secret()
    device_info = login_alerts.session_device_info(request.headers.get("user-agent"))  # [Gate S9]
    if mfa_verified:
        device_info = dict(device_info or {})
        device_info[mfa.SESSION_MFA_KEY] = datetime.now(timezone.utc).isoformat()
    session = auth_manager.create_session(
        user_id=user.id,
        refresh_token_hash=_hash_refresh_secret(secret),
        ip_address=client_ip,
        device_info=device_info,
        db=db,
    )
    _set_refresh_cookie(response, f"{session.id}.{secret}")
    access_token = _access_token_for(user, session.id)
    # [Gate S9] 過去90日に無い端末からのログインなら、本人に通知する(乗っ取りに早く気付けるように)
    if login_alerts.notify_if_new_device(db, user, session, user_agent=request.headers.get("user-agent"),
                                         ip=client_ip):
        record_audit_event(action="login_new_device", resource_type="user", user_id=user.id,
                           resource_id=user.id, ip_address=client_ip,
                           details={"session_id": str(session.id)})

    # [Gate R2-7] 監査ログ: ログイン成功
    details: Dict[str, Any] = {"session_id": str(session.id)}
    if mfa_verified:
        details["mfa"] = mfa_method or "totp"
    record_audit_event(
        action="login_success",
        resource_type="user",
        user_id=user.id,
        resource_id=user.id,
        ip_address=client_ip,
        user_agent=request.headers.get("user-agent", "")[:255],
        details=details,
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_user_response(user)
    )


@router.post("/login", response_model=Union[TokenResponse, MfaChallengeResponse])
async def login(
    login_data: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """ユーザーログイン"""

    # [Gate #28] IPベース・メールアドレスベース両方でレート制限する
    # (単一IPからの複数アカウント総当り、単一アカウントへの分散総当り
    # の双方をある程度緩和する)。
    challenge.require(request, "login")  # [Gate S7]
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login_ip:{client_ip}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )
    if not check_rate_limit(f"login_email:{login_data.email}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )

    try:
        # ユーザー取得
        user = db.query(User).filter(User.email == login_data.email).first()

        if not user or not verify_password(login_data.password, user.hashed_password):
            # [Gate R2-7] 監査ログ: ログイン失敗。総当り調査のためメール
            # アドレス自体はdetailsに残すが、パスワードは一切記録しない。
            record_audit_event(
                action="login_failed",
                resource_type="user",
                user_id=(user.id if user else None),
                ip_address=client_ip,
                user_agent=request.headers.get("user-agent", "")[:255],
                details={"email": login_data.email},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="メールアドレスまたはパスワードが正しくありません"
            )

        if not user.is_active:
            record_audit_event(
                action="login_failed",
                resource_type="user",
                user_id=user.id,
                ip_address=client_ip,
                user_agent=request.headers.get("user-agent", "")[:255],
                details={"reason": "account_inactive"},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="アカウントが無効です"
            )

        # [Gate S11] 多要素認証を設定している利用者は、ここではセッションを作らず確認コードを求める
        if mfa.is_enabled(db, user.id):
            mfa_token, _jti = mfa.issue_mfa_token(user.id)
            record_audit_event(action="login_mfa_challenge", resource_type="user", user_id=user.id,
                               resource_id=user.id, ip_address=client_ip,
                               user_agent=request.headers.get("user-agent", "")[:255])
            return MfaChallengeResponse(mfa_token=mfa_token, methods=["totp", "recovery_code"],
                                        expires_in=mfa.MFA_TOKEN_TTL_SECONDS)

        return complete_login(db, user, request, response, mfa_verified=False)

    except HTTPException:
        raise
    except Exception:
        request_id = getattr(request.state, "request_id", "unknown")
        logger.exception(f"[{request_id}] login failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ログインに失敗しました。しばらくしてから再試行してください。"
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """[Gate #28] refresh tokenをhttpOnly cookieから読み取り、ローテーション
    したうえで新しいaccess token/refresh tokenを発行する。1つのrefresh
    tokenは1回しか使えない(使うたびに新しいものへ入れ替わる)。既に
    ローテーション済みの(=一度使われた)tokenが再送された場合は盗用の
    兆候とみなし、そのセッションを即座に失効させて401を返す。"""
    _reject_cross_site(request)  # [Gate S4]
    # [Gate S3] refresh も回数を制限する(盗んだ token・推測した cookie の連続試行を抑える)
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"refresh:{client_ip}", settings.RATE_LIMIT_REFRESH, 60):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="試行回数が上限に達しました。しばらく待ってから再試行してください。")
    raw_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    session_id, secret = _parse_refresh_cookie(raw_cookie) if raw_cookie else (None, None)

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="セッションが無効です。再度ログインしてください。"
    )
    if not session_id or not secret:
        raise invalid

    # [Gate S2] 以前は「読む→比べる→無条件に書き換える」で行ロックが無く、同じ refresh token の並列要求が
    # 両方とも成功し得た(盗んだ token と正規の利用者が同時に使っても検知できない)。行ロック(SELECT … FOR UPDATE)
    # の中で、検証・入れ替え・失効を1つのトランザクションで行う。
    try:
        session_uuid = uuid.UUID(str(session_id))
    except ValueError:
        raise invalid
    session = db.query(UserSession).filter(UserSession.id == session_uuid).with_for_update().first()
    if not session:
        db.rollback()
        raise invalid

    presented_hash = _hash_refresh_secret(secret)
    now = datetime.now(timezone.utc)

    if not session.is_active or (session.expires_at and session.expires_at <= now):
        db.rollback()
        response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
        raise invalid

    rotate = True
    if not hmac.compare_digest(session.session_token, presented_hash):
        if _within_refresh_grace(session, presented_hash, now):
            # [Gate S2] 同じブラウザの複数タブが同時に refresh した(先の要求が直前に入れ替えた)。
            # 盗用ではないので失効させず、アクセストークンだけを発行する。cookie は先の応答が既に新しくしている。
            rotate = False
        else:
            # [Gate #28] 再利用検知: 既にローテーション済みのtokenが送られてきた。
            # 盗用されたrefresh tokenが使われた可能性があるため、このセッション
            # を即座に失効させる。
            session.is_active = False
            session.updated_at = now
            db.commit()
            auth_manager.revoke_session(str(session.id), db)
            response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
            logger.warning("refresh token reuse detected, session revoked: %s", session.id)
            record_audit_event(action="refresh_token_reuse_detected", resource_type="session",
                               user_id=session.user_id, resource_id=session.id)
            raise invalid

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user or not user.is_active:
        session.is_active = False
        session.updated_at = now
        db.commit()
        auth_manager.revoke_session(str(session.id), db)
        response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
        raise invalid

    if rotate:
        new_secret = _generate_refresh_secret()
        info = dict(session.device_info or {})
        info[_REFRESH_PREV_KEY] = session.session_token
        info[_REFRESH_ROTATED_AT_KEY] = now.isoformat()
        session.device_info = info
        session.session_token = _hash_refresh_secret(new_secret)
        session.expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        session.updated_at = now
        db.commit()
        _set_refresh_cookie(response, f"{session.id}.{new_secret}")
    else:
        db.commit()  # 行ロックを放す
    access_token = _access_token_for(user, session.id)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_user_response(user),
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    auth_result=Depends(get_current_user_optional),
):
    """[Gate #28] 現在のセッションのみ失効させる。

    [Gate S4] 以前はアクセストークンが期限切れだと 401 になり、セッションも cookie も残った(画面上は
    ログアウトしたのに、cookie の更新鍵でまた入れる)。アクセストークンが無効でも受け付け、
    アクセストークンのセッションと、cookie の更新鍵が今も正しいセッションの両方を失効させる。"""
    _reject_cross_site(request)
    revoked = set()
    token_data = getattr(auth_result, "token_data", None)
    token_session = getattr(token_data, "session_id", None)
    if token_session and not getattr(auth_result, "is_guest", False):
        auth_manager.revoke_session(token_session, db)
        revoked.add(str(token_session))
    cookie_session = _session_from_refresh_cookie(request, db)
    if cookie_session is not None and str(cookie_session.id) not in revoked:
        auth_manager.revoke_session(str(cookie_session.id), db)
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return {"message": "ログアウトしました"}


@router.post("/logout-all")
async def logout_all(
    response: Response,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate #28] 現在のユーザーの全セッションを失効させる(全デバイスでログアウト)。"""
    auth_manager.revoke_all_user_sessions(str(current_user.id), db)
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return {"message": "すべてのデバイスからログアウトしました"}


@router.get("/sessions", response_model=List[SessionInfo])
async def list_sessions(
    current_user: User = Depends(get_current_active_user),
    current_session_id: Optional[str] = Depends(get_current_session_id),
    db: Session = Depends(get_db),
):
    """[Gate #28] 現在有効なセッション(ログイン中デバイス)の一覧。"""
    sessions = (
        db.query(UserSession)
        .filter(
            UserSession.user_id == current_user.id,
            UserSession.is_active.is_(True),
            UserSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(UserSession.created_at.desc())
        .all()
    )
    return [
        SessionInfo(
            id=str(s.id),
            ip_address=s.ip_address,
            device_info=_public_device_info(s.device_info),
            created_at=s.created_at,
            expires_at=s.expires_at,
            is_current=(str(s.id) == str(current_session_id)),
            device_label=str((s.device_info or {}).get("device")
                             or login_alerts.device_label((s.device_info or {}).get("user_agent"))),
            network_label=login_alerts.network_label(s.ip_address),
            last_active_at=s.updated_at or s.created_at,
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}")
async def revoke_session_endpoint(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate #28] 指定したセッションを失効させる(他デバイスの個別ログアウト)。
    自分以外のユーザーのセッションは失効できない(403)。"""
    session = db.query(UserSession).filter(UserSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="セッションが見つかりません")
    if str(session.user_id) != str(current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="このセッションを操作する権限がありません")
    auth_manager.revoke_session(session_id, db)
    return {"message": "セッションを失効させました"}

# [Gate R0] 認証不要な診断用エンドポイント。settings.DEBUG限定にする
# (DEBUG=Falseでは404)。


@router.get("/test")
async def test_auth():
    """認証API テスト(DEBUG限定)"""
    if not settings.DEBUG:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return {
        "message": "Authentication API is working",
        "endpoints": [
            "POST /api/v1/auth/register",
            "POST /api/v1/auth/login"
        ]
    }


# ===== プロフィール関連API =====
# [Gate #20] SettingsPage.tsx(プロフィール/通知設定/環境設定)の保存処理は
# 常にsetTimeoutで成功を偽装するだけで、実際にはどこにも保存していなかった。
# User.preferencesはUUIDベースラインの時点で既にモデル・DBに存在していた
# (マイグレーション不要)ため、GET/PUT /auth/meを実装してこのJSONカラムに
# username/email以外の任意設定(通知設定・言語/タイムゾーン等)をまとめて保存する。
# あわせて、authStore.tsのcheckAuth()が呼んでいた/auth/me(GET)がこれまで
# 存在しておらず404になる状態だったのも解消する。

@router.get("/me", response_model=UserDetailResponse)
async def get_me(
    current_user: User = Depends(get_current_active_user)
):
    """現在のユーザー情報を取得(preferencesを含む)"""
    return current_user


@router.put("/me", response_model=UserDetailResponse)
async def update_me(
    update_data: UserUpdate,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    current_session_id: Optional[str] = Depends(get_current_session_id),
    db: Session = Depends(get_db)
):
    """現在のユーザー情報を更新

    [Gate S2] メールアドレスの変更は、乗っ取られたセッションから連絡先(=パスワード再設定の宛先)を奪われると
    アカウントを取り戻せなくなるため、現在のパスワードによる再認証を必須にする。変更後は確認済みの状態を外し、
    ほかの端末のセッションを失効させる(監査にはメールアドレスを残さない)。
    """
    email_changing = update_data.email is not None and update_data.email != current_user.email
    if email_changing:
        client_ip = request.client.host if request.client else "unknown"
        if not check_rate_limit(f"reauth:{current_user.id}", settings.RATE_LIMIT_AUTH, 60):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail="確認の回数が上限に達しました。しばらく待ってから再試行してください。")
        if not update_data.current_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="メールアドレスを変更するには、現在のパスワードを入力してください")
        if not current_user.hashed_password or not verify_password(update_data.current_password,
                                                                   current_user.hashed_password):
            record_audit_event(action="reauth_failed", resource_type="user", user_id=current_user.id,
                               resource_id=current_user.id, ip_address=client_ip,
                               details={"purpose": "email_change"})
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="現在のパスワードが正しくありません")
    try:
        if update_data.username is not None and update_data.username != current_user.username:
            existing = db.query(User).filter(
                User.username == update_data.username,
                User.id != current_user.id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="このユーザー名は既に使用されています"
                )
            current_user.username = update_data.username

        if update_data.email is not None and update_data.email != current_user.email:
            existing = db.query(User).filter(
                User.email == update_data.email,
                User.id != current_user.id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="このメールアドレスは既に使用されています"
                )
            current_user.email = update_data.email
            current_user.is_verified = False

        if update_data.preferences is not None:
            # 既存のpreferencesとマージ(通知設定だけ更新、等の部分更新に対応)
            merged = dict(current_user.preferences or {})
            # [Gate K1] オフライン鍵の版(offline_pack_key)はサーバーだけが変える。利用者が送った値で
            # 版を戻すと、失効した鍵が再び配られてしまうため、プロフィール更新では受け付けない。
            client_prefs = {k: v for k, v in update_data.preferences.items() if k != "offline_pack_key"}
            merged.update(client_prefs)
            current_user.preferences = merged

        db.commit()
        db.refresh(current_user)
        if email_changing:
            auth_manager.revoke_all_user_sessions(str(current_user.id), db, except_session_id=current_session_id)
            record_audit_event(action="email_changed", resource_type="user", user_id=current_user.id,
                               resource_id=current_user.id,
                               ip_address=request.client.host if request.client else None,
                               details={"other_sessions_revoked": True})
        return current_user
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("profile update failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロフィールの更新に失敗しました。しばらくしてから再試行してください。"
        )


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_active_user),
    current_session_id: Optional[str] = Depends(get_current_session_id),
    db: Session = Depends(get_db)
):
    """[Gate #21] パスワード変更。SettingsPage.tsxで「開発中」として無効化
    されていた機能を実装する。frontend/src/services/api.tsのchangePasswordが
    既に呼んでいた /auth/change-password をここで実装する。
    [Gate #28] パスワード変更後は今使っているセッション以外の全セッション
    (=他デバイスのログイン状態)を失効させる。パスワードが漏洩して変更した
    ケースを想定した既定挙動。"""
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="現在のパスワードが正しくありません"
        )
    _enforce_password_policy(password_data.new_password, email=current_user.email, username=current_user.username)
    if password_data.new_password == password_data.current_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="新しいパスワードは現在のパスワードと違うものにしてください")

    try:
        current_user.hashed_password = hash_password(password_data.new_password)
        db.commit()
        auth_manager.revoke_all_user_sessions(
            str(current_user.id), db, except_session_id=current_session_id
        )
        return {"message": "パスワードを変更しました。他のデバイスからはログアウトされます。"}
    except Exception:
        db.rollback()
        logger.exception("password change failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="パスワードの変更に失敗しました。しばらくしてから再試行してください。"
        )
