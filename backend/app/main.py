from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from functools import lru_cache
from pathlib import Path
from sqlalchemy import text
from app.api.v1 import (
    spots, travel, ai, admin, share, notifications, plans, public_share, search,
    quickdrafts, reservations, documents, imports, segments, route_options, constraints,
    validation, preparation, finance, discussion, booklet, itinerary_export, data_export, branches,
    calendar_import, privacy, replans, optimization, sync, memories, location_tracks, journey, atlas, memory_replan,
    offline_pack, security_reports, presence, private_profile, visits, candidates, places, plan_search,
    organizations, org_external,
)
from app.core.exceptions import TravelCanvasException, ErrorCategory
from app.core.config import settings
from app.core.security_headers import apply_security_headers
from app.core.body_limit import BodySizeLimitMiddleware
from app.services import threat_guard
from starlette.concurrency import run_in_threadpool
import logging
import time
import uuid

from app.ops import metrics as ops_metrics

logger = logging.getLogger("travelcanvas")

# [Gate M10 CORS調査] CORSMiddlewareへ渡す許可オリジン一覧。以下の
# unhandled_exception_handlerでも同じ一覧を参照する(単一の真実源)。
_ALLOWED_CORS_ORIGINS = (
    settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else [settings.CORS_ORIGINS]
)


def _cors_headers_for_origin(request: Request) -> dict:
    """[Gate M10 CORS調査で判明したFastAPI/Starletteの既知の挙動への対処]

    `@app.exception_handler(Exception)`(このファイル下部で登録)は
    StarletteのServerErrorMiddlewareにフックされる特別なハンドラであり、
    ミドルウェアスタック上でCORSMiddlewareより外側(=CORSMiddlewareを
    通らない経路)で実行される。そのため、ルートハンドラ内で
    HTTPException以外の未処理例外が発生すると、レスポンス自体は
    正常に返るにもかかわらずAccess-Control-Allow-Originヘッダーが
    一切付与されず、ブラウザからは実体(500エラー)ではなく
    「CORS policyでブロック」としか見えない現象が起きる
    (Gate M10でdocuments系エンドポイントのみ発生していた問題の根本原因)。

    根本原因となっていたPermissionError自体はGate M10で個別に修正済み
    だが、将来別の想定外例外が発生した場合にも同じ現象を再発させない
    ため、ここでCORSMiddlewareと同じ判定ロジック(許可リストと完全一致
    するOriginのみ許可)でヘッダーを手動付与する(防御的多重化)。
    """
    origin = request.headers.get("origin")
    if not origin or origin not in _ALLOWED_CORS_ORIGINS:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


# アプリケーション作成
app = FastAPI(
    title="TravelCanvas API",
    description="AI-powered travel planning application",
    version="1.0.0",
    # [Gate S2] 本番では API の一覧・試せる画面(Swagger/ReDoc/OpenAPI)を公開しない(攻撃面を減らす)
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)


# [Gate #28] request_idをリクエストごとに発行し、レスポンスヘッダーと
# エラーレスポンス両方に載せる。内部例外の文字列自体はクライアントへ
# 返さず(下のグローバルハンドラ参照)、サーバー側ログとrequest_idで
# 追跡できるようにする。
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    # [Gate O1] 監視用の計測(ルートの型・状態の種類・所要時間)。実際のURLは記録しない。
    started = time.perf_counter()
    # [Gate S6] SEC-16/17 遮断中の接続元からの API は、処理せずに 429 を返す(監視の入口は止めない)
    path = request.url.path
    guarded = not threat_guard.is_exempt_path(path)
    client_ip = threat_guard.client_ip(request)
    if guarded:
        until = threat_guard.blocked_until(client_ip)
        if until:
            retry_after = max(1, int(until - time.time()))
            blocked = JSONResponse(
                status_code=429,
                content={"detail": threat_guard.BLOCKED_DETAIL, "request_id": request_id},
                headers={"Retry-After": str(retry_after)},
            )
            ops_metrics.registry.observe(
                request.method, ops_metrics.route_template(request.scope), 429, time.perf_counter() - started)
            blocked.headers["X-Request-ID"] = request_id
            apply_security_headers(path, blocked.headers)
            return blocked
    try:
        response = await call_next(request)
    except Exception:
        ops_metrics.registry.observe(
            request.method, ops_metrics.route_template(request.scope), 500, time.perf_counter() - started)
        raise
    ops_metrics.registry.observe(
        request.method, ops_metrics.route_template(request.scope), response.status_code,
        time.perf_counter() - started)
    response.headers["X-Request-ID"] = request_id
    # [Gate S6] 失敗した応答を、接続元ごとの「怪しさの点数」にする(成功・監視の入口は数えない)
    if guarded and response.status_code >= 400:
        auth_header = request.headers.get("authorization") or ""
        kind = threat_guard.classify_response(
            request.method, path, response.status_code, auth_header.lower().startswith("bearer "))
        if kind:
            # 点数が閾値を越えた時は監査(DB)へ書くため、イベントループを止めないよう別スレッドで数える
            await run_in_threadpool(threat_guard.signal, request, kind)
    # [Gate S2] SEC-03 セキュリティヘッダー(app/core/security_headers.py)
    apply_security_headers(request.url.path, response.headers)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """[Gate #28] 個別routeのexcept Exception as e節が str(e) をそのまま
    detailへ返し、内部の例外メッセージ(SQLエラー文等)をクライアントへ
    露出させていた(auth.pyのregister/login/change_password等)。
    この後の修正でそれらは汎用メッセージ+request_idを返すよう変更したが、
    想定外の未捕捉例外についても、ここで最終防波堤として同様に扱う。"""
    request_id = getattr(request.state, "request_id", "unknown")
    ops_metrics.registry.count_exception()
    logger.exception(f"[{request_id}] Unhandled exception on {request.method} {request.url.path}")
    error_response = JSONResponse(
        status_code=500,
        content={
            "detail": "サーバー内部でエラーが発生しました。しばらくしてから再試行してください。",
            "request_id": request_id,
        },
        # [Gate M10 CORS調査] このハンドラはCORSMiddlewareの外側で実行される
        # ため、CORSMiddleware自体はこのレスポンスにヘッダーを付与できない。
        # _cors_headers_for_origin()で同じ許可リストに基づき明示的に付与する。
        headers=_cors_headers_for_origin(request),
    )
    apply_security_headers(request.url.path, error_response.headers)  # [Gate S2]
    return error_response


# CORS設定
# [Gate #28] allow_origins=["*"] と allow_credentials=True の組み合わせは
# 仕様上無効(ブラウザはワイルドカードOriginへのcredentials付きレスポンスを
# 拒否する)。refresh tokenをhttpOnly cookieで発行する都合上、Cookie送信には
# credentials付きリクエストが必須のため、実際に許可するオリジンを明示する
# settings.CORS_ORIGINSへ切り替える。
# [Gate L2] PATCHが許可メソッドに無く、別オリジン(frontend :4173 → backend :8001)の
# ブラウザからのPATCHはプリフライト(OPTIONS)が400で拒否され、一度も送信されて
# いなかった(区間・経路候補・経路区間・予約×イベント紐付けの編集が画面から不能)。
# 単体試験はHTTP層を差し替えるため検出できず、制約編集のbrowser E2Eで発覚した。
# 全ルートのメソッドが許可されていることは tests/test_gate_l2_cors_methods.py で検査する。
CORS_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

# [Gate S4] 要求の本文の上限(app/core/body_limit.py)。CORS より内側に置き、413 にも CORS のヘッダーが付くようにする
# (外側に置くと、画面からは「CORS で拒否」としか見えない)。
app.add_middleware(BodySizeLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=CORS_ALLOWED_METHODS,
    allow_headers=["*"],
    # [Gate P5/P6] 書き出しの件数・ファイル名・内容のハッシュ(エクスポート)を画面で読めるようにする
    expose_headers=[
        "X-Export-Count", "X-Export-Skipped", "X-Export-Excluded", "Content-Disposition", "X-Content-SHA256",
        # [Gate S7] 計算の確認(428)の問題を画面が読めるようにする
        "X-TC-Challenge", "X-TC-Challenge-Difficulty", "X-TC-Challenge-Algorithm", "Retry-After",
    ],
)

# 基本エンドポイント


@app.get("/")
async def root():
    return {
        "message": "TravelCanvas API is running",
        "status": "OK",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """[Gate #34] liveness専用。プロセスが応答できているかのみを見る。
    DB接続・migration状態はここでは確認しない(readinessは/readyに分離)。"""
    return {
        "status": "OK",
        "message": "TravelCanvas API is healthy",
        "version": "1.0.0"
    }


# [Gate #34 P0-06] 従来の/healthはDB接続やmigration状態を一切見ないため、
# DBが落ちていてもauth routerが欠落していても常にOKを返し得た(2026-09-05
# 監査 P1-06)。/readyをliveness([/health)とは別の readiness として新設し、
# DB接続・alembicのmigration head到達・必須routerの登録有無を確認する。
# 失敗時は503を返し、接続文字列や内部例外の本文は一切含めない。
_REQUIRED_ROUTE_PREFIXES = ("/api/v1/auth", "/api/v1/travel-plans", "/api/v1/plans")


def _check_required_routers_registered() -> bool:
    # [Gate S1] 新しい FastAPI では app.routes に取り込んだルーターが展開されないため、route_index で列挙する
    from app.core.route_index import route_paths

    registered_paths = route_paths(app)
    for prefix in _REQUIRED_ROUTE_PREFIXES:
        if not any(p.startswith(prefix) for p in registered_paths):
            return False
    return True


def _check_database_ready() -> bool:
    from app.core.database import engine
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.exception("readiness check: database connectivity failed")
        return False


def _check_migration_head_ready() -> bool:
    """alembic_versionテーブルに何らかのrevisionが記録されていることのみ
    確認する(具体的なrevision文字列はビルドごとに変わるため一致比較は
    しない。テーブル不在/空はmigration未適用の signal として扱う)。"""
    from app.core.database import engine
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).first()
        return row is not None
    except Exception:
        logger.exception("readiness check: migration head check failed")
        return False


@lru_cache(maxsize=1)
def _alembic_script_heads() -> frozenset:
    """[Gate O1] コードが持つ migration の head(起動中は変わらないのでキャッシュ)。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    ini = Path(__file__).resolve().parent.parent / "alembic.ini"
    cfg = Config(str(ini))
    cfg.set_main_option("script_location", str(ini.parent / "alembic"))
    return frozenset(ScriptDirectory.from_config(cfg).get_heads())


def _check_migration_current() -> bool:
    """[Gate O1] DB の版がコードの migration head と一致するか。

    従来の migration チェックは「何らかの版が記録されている」ことしか見ておらず、コードを
    更新して ``alembic upgrade head`` を忘れた状態(新しい表が無いまま動く)でも ready と答えていた。
    rollback(コードだけ戻して downgrade を忘れた状態)の取り違えもここで検出する。"""
    from app.core.database import engine
    try:
        heads = _alembic_script_heads()
        with engine.connect() as conn:
            rows = {r[0] for r in conn.execute(text("SELECT version_num FROM alembic_version"))}
        return bool(heads) and rows == set(heads)
    except Exception:
        logger.exception("readiness check: migration version comparison failed")
        return False


@app.get("/ready")
async def readiness_check():
    db_ok = _check_database_ready()
    migration_ok = db_ok and _check_migration_head_ready()
    migration_current_ok = migration_ok and _check_migration_current()
    routers_ok = _check_required_routers_registered()

    checks = {
        "database": db_ok,
        "migration": migration_ok,
        "migration_current": migration_current_ok,
        "required_routers": routers_ok,
    }
    all_ok = all(checks.values())

    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "ready" if all_ok else "not_ready", "checks": checks},
    )


@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint(request: Request):
    """[Gate O1] 監視用の計測値(Prometheus のテキスト形式)。

    METRICS_TOKEN を設定した場合は ``Authorization: Bearer <METRICS_TOKEN>`` が必要。未設定の時は
    同じ機械・LAN(私設アドレス)からの要求だけに見せる。見せない時は存在も明かさず404。"""
    client_host = request.client.host if request.client else None
    token = getattr(settings, "METRICS_TOKEN", None)
    if not ops_metrics.metrics_access_allowed(client_host, request.headers.get("authorization"), token):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return PlainTextResponse(
        ops_metrics.registry.render(), media_type="text/plain; version=0.0.4; charset=utf-8",
        headers={"Cache-Control": "no-store"})


@app.get("/api/v1/health")
async def api_health():
    return {
        "status": "healthy",
        "api_version": "v1",
        "endpoints": [
            "/docs",
            "/health",
            "/ready",
            "/api/v1/auth/register",
            "/api/v1/auth/login"
        ]
    }

# [Gate R0] 認証不要な診断用エンドポイント。以前は本番でも常時公開されて
# いたため、settings.DEBUG限定にする(DEBUG=Falseでは404)。


@app.get("/test")
async def test_endpoint():
    if not settings.DEBUG:
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return {
        "message": "Test endpoint working",
        "cors": "enabled"
    }

# エラーハンドラー


@app.exception_handler(404)
async def not_found_handler(request, exc):
    # [Gate #29] このハンドラはステータスコード404の"全て"を横取りする
    # ため、以前はルーティング自体が一致しなかった場合(Starletteの既定
    # detail="Not Found")と、route内で意図的にraiseしたHTTPException(404,
    # detail="...")の両方を区別せず、後者の具体的なメッセージまで
    # "Endpoint not found: ..." という汎用文言で上書きしてしまっていた
    # (/plans/{id}/undoの「取り消せる変更がありません」で発覚したが、
    # spots.py/travel.py等、404を意図的に返す全routeに影響していた
    # 既存バグ)。Starletteの既定detailの時だけ汎用メッセージにする。
    detail = getattr(exc, "detail", None)
    if detail and detail != "Not Found":
        # [Gate P4] route側が付けたヘッダー(公開共有の X-Robots-Tag 等)を落とさない
        return JSONResponse(status_code=404, content={"detail": detail}, headers=getattr(exc, "headers", None))
    return JSONResponse(
        status_code=404,
        content={"detail": f"Endpoint not found: {request.url.path}"}
    )

# [Gate #27] app/core/exceptions.py には AuthenticationError/AuthorizationError/
# ValidationError等の統一例外クラス一式が定義されていたが、これらを捕捉する
# exception_handlerがこれまで一切登録されておらず、例えば未認証状態で保護された
# エンドポイントへアクセスした場合(get_current_active_userがAuthenticationErrorを
# raiseするケース)、クリーンな401ではなく未処理例外としてサーバーエラーになって
# いた(通常のログイン済みフローでは踏まれない経路のため、手動テストや監査でも
# 発見されていなかった)。カテゴリ別に適切なHTTPステータスへ変換する。
_CATEGORY_STATUS_MAP = {
    ErrorCategory.AUTHENTICATION: 401,
    ErrorCategory.AUTHORIZATION: 403,
    ErrorCategory.VALIDATION: 422,
    ErrorCategory.BUSINESS_LOGIC: 400,
    ErrorCategory.RATE_LIMIT: 429,
    ErrorCategory.EXTERNAL_SERVICE: 502,
    ErrorCategory.MAINTENANCE: 503,
    ErrorCategory.SYSTEM: 500,
}


@app.exception_handler(TravelCanvasException)
async def travelcanvas_exception_handler(request: Request, exc: TravelCanvasException):
    status_code = _CATEGORY_STATUS_MAP.get(exc.category, 500)
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": exc.user_message,
            "error_code": exc.error_code.value if exc.error_code else None,
            "error_id": exc.error_id,
        },
    )

# [Gate R2-2] QuickDraft(POST /quick-drafts, 今後のpromoteも含む)のみ、
# DOC-06準拠のapplication/problem+jsonエラー封筒を新規導入する。既存API
# ({"error":{...}}形式)は本Gateでは変更しない(影響範囲を限定するため、
# 全API統一は別Gateで行う。docs/adr/ADR-quick-draft.md §7参照)。
from app.api.v1.quickdrafts import QuickDraftProblemError  # noqa: E402


@app.exception_handler(QuickDraftProblemError)
async def quickdraft_problem_handler(request: Request, exc: QuickDraftProblemError):
    return JSONResponse(
        status_code=exc.status_code,
        media_type="application/problem+json",
        content={
            "type": "about:blank",
            "title": exc.message,
            "status": exc.status_code,
            "code": exc.code,
            "correlation_id": getattr(request.state, "request_id", None),
        },
    )

# [Gate #34 P0-05] 認証APIルートを含める。
# 以前は`except ImportError`で握り潰し、「基本機能のみで起動」を続けて
# いた(2026-09-05監査)。認証routerが欠落した状態でも/healthがOKを返し
# 続け、障害の発見が遅れる致命的なfail-silentだったため、ここでは
# 例外を握り潰さず、そのまま起動失敗として伝播させる(fail-fast)。
from app.api.v1.auth import router as auth_router  # noqa: E402
from app.api.v1 import mfa as mfa_api  # noqa: E402
app.include_router(auth_router, prefix="/api/v1/auth", tags=["authentication"])
# [Gate S11] SEC-06 多要素認証(/api/v1/auth/mfa/*)
app.include_router(mfa_api.router, prefix="/api/v1/auth")
logger.info("Auth routes loaded successfully")

logger.info("TravelCanvas API - Ready to start")

app.include_router(spots.router, prefix="/api/v1")
# [Gate M10-R2 P1] travel.router(GET /travel-plans/{plan_id}、plan_id:
# uuid.UUID)とshare.router(同じ/travel-plans prefix配下に固定文字列route
# GET /travel-plans/invitations等を持つ)は、共にprefix="/travel-plans"を
# 共有している。FastAPI/Starletteはrouteを登録順に評価するため、
# travel.routerを先に登録すると、"/travel-plans/invitations"へのGETが
# share.routerの専用route(list_my_invitations)まで到達する前に
# travel.routerの"/{plan_id}"へ"invitations"という文字列がplan_idとして
# 束縛される形でマッチしてしまい、uuid.UUIDへの変換に失敗して422
# (FastAPI標準のRequestValidationError)になっていた。この422は
# frontend側のhandleApiError()がdetail配列をそのままtoast.error()へ
# 渡してReactをクラッシュさせる別バグ(同Gateで別途修正)と重なり、
# 「招待の一覧取得に失敗し、画面全体がクラッシュする」形で顕在化して
# いた。固定文字列routeを持つshare.routerを、可変routeの travel.router
# より先に登録することで、"/travel-plans/invitations"が正しく
# share.router側にマッチするようにする(share.routerの他のrouteは全て
# "/{plan_id}/share"等、plan_idの後に固定文字列が続く形のみでtravel.router
# の"/{plan_id}"単体routeとは衝突しないため、この並び替えは安全)。
app.include_router(share.router, prefix="/api/v1")
app.include_router(travel.router, prefix="/api/v1")
# [Gate #23] ai.pyはこれまでファイルは存在するがinclude_routerされておらず、
# /optimize-route・/optimization/*系エンドポイントが実際には一切到達不能だった。
# [Gate #34] このrouterは現在、全エンドポイントが410 Goneを返す廃止済みAPI。
app.include_router(ai.router, prefix="/api/v1")
# [Gate #24] admin.pyも同様にinclude_routerされておらず、/admin/*は一切到達不能だった。
app.include_router(admin.router, prefix="/api/v1")
# [Gate #30] 認証不要の共有トークン解決API。share.router(owner専用管理API)
# とはpath prefixレベルで完全に分離している(/public/share vs /travel-plans)。
app.include_router(public_share.router, prefix="/api/v1")
# [Gate #31] frontend直アクセスだった検索(Wikipedia/Nominatim/Overpass)を
# backendへ集約するcandidate/place API。
app.include_router(search.router, prefix="/api/v1")
# [Gate #26] notifications.pyも新規実装。通知一覧・既読管理のエンドポイント。
app.include_router(notifications.router, prefix="/api/v1")
# [Gate S10] ブラウザからの CSP 違反の報告(認証なし・数えるだけ)
app.include_router(security_reports.router, prefix="/api/v1")
# [Gate #29] /plans: travel_days/travel_events正規テーブルを正本とする新API。
# 既存の/travel-plans(itinerary JSONベース)と並行稼働する(metadata CRUDのみ)。
app.include_router(plans.router, prefix="/api/v1")
# [Gate M1] FR-014移動区間。/plans/{plan_id}/segments配下のCRUD
# (app/api/v1/segments.py)。既存route-preview/insertion-preview
# (plans.py、非永続)とは独立。
app.include_router(segments.router, prefix="/api/v1")
# [Gate M3] FR-015複数経路比較。/plans/{plan_id}/route-options配下。
app.include_router(route_options.router, prefix="/api/v1")
# [Gate R2-2] POST /quick-drafts (DOC-06正式契約)。anonymous device tokenで
# ログイン前にplan/day/event相当を単一transactionで作成する。promote
# (/quick-drafts/{id}/promote)はGate R2-3で追加する。
app.include_router(quickdrafts.router, prefix="/api/v1")
# [Gate R3-0] FR-010予約管理の最小実装。/plans/{plan_id}/reservations配下。
# plans.router(/plans)と同じprefixだが別routerファイルであり、
# plans.pyのdays/events CRUDとは独立して管理する。
app.include_router(reservations.router, prefix="/api/v1")
# [Gate R3-6] FR-013文書ウォレットの最小実装。/plans/{plan_id}/documents配下。
app.include_router(documents.router, prefix="/api/v1")
# [Gate R3-7] FR-011予約取込の最小実装。/plans/{plan_id}/imports配下。
app.include_router(imports.router, prefix="/api/v1")
# [Gate L2] FR-016制約管理。/plans/{plan_id}/constraints配下(ハード/ソフト、共有/秘匿)。
app.include_router(constraints.router, prefix="/api/v1")
# [Gate L3] FR-017実行可能性検証。/plans/{plan_id}/validation-runs配下(違反と検証不能を分けて返す)。
app.include_router(validation.router, prefix="/api/v1")
# [Gate P1] FR-025持ち物 / FR-026準備タスク・レディネス。/plans/{plan_id}/packing-items・
# preparation-tasks・readiness・members配下。
app.include_router(preparation.router, prefix="/api/v1")
# [Gate P2] FR-027予算・費用 / FR-028立替・精算。/plans/{plan_id}/finance-settings・budgets・expenses・
# settlements・finance-summary配下。
app.include_router(finance.router, prefix="/api/v1")
# [Gate P3] FR-022合意形成(投票・懸念) / FR-024コメント・メンション通知。/plans/{plan_id}/polls・comments配下。
app.include_router(discussion.router, prefix="/api/v1")
# [Gate P4] FR-034しおり生成 / FR-035安全な印刷・公開 / FR-046 PDF出力。/plans/{plan_id}/booklet・booklet-exports配下。
app.include_router(booklet.router, prefix="/api/v1")
# [Gate P5] FR-036カレンダー・地図の書き出し(ICS/GPX/KML/CSV)。/plans/{plan_id}/exports/*配下。
app.include_router(itinerary_export.router, prefix="/api/v1")
# [Gate P6] FR-039データポータビリティ。/plans/{plan_id}/data-export、/privacy/data-export・retention。
app.include_router(data_export.plans_router, prefix="/api/v1")
app.include_router(data_export.privacy_router, prefix="/api/v1")
# [Gate P7] FR-019 What-if・旅程ブランチ。/plans/{plan_id}/branches配下。
app.include_router(branches.router, prefix="/api/v1")
# [Gate P8] FR-036カレンダー(ICS)の取込(差分確認後に適用)。/plans/{plan_id}/calendar-import配下。
app.include_router(calendar_import.router, prefix="/api/v1")
# 🗑️ [Gate P9] アカウント削除・同意の撤回(FR-039)
app.include_router(privacy.router, prefix="/api/v1")
# [Gate P10] FR-030 外部状況(アラート)・FR-031 安全な再計画。/plans/{plan_id}/alerts・/plans/{plan_id}/replans配下。
app.include_router(replans.router, prefix="/api/v1")
# [Gate L4] FR-018 説明可能な最適化(制約・実行可能性検証を入力にした並べ替え候補)。/plans/{plan_id}/days/{day_id}配下。
app.include_router(optimization.router, prefix="/api/v1")
# [Gate P11] FR-033 オフライン編集・同期(操作の受領・競合の解決)。/plans/{plan_id}/sync配下。
app.include_router(sync.router, prefix="/api/v1")
# [Gate P12] FR-037 写真・メモ・旅行記。/plans/{plan_id}/memories配下。
app.include_router(memories.router, prefix="/api/v1")
# [Gate P13] FR-038 任意の位置軌跡(本人だけの記録)。/plans/{plan_id}/location-tracks配下。
app.include_router(location_tracks.router, prefix="/api/v1")
# [Gate P14] FR-054 Plan-to-Memory・FR-053 旅の達成指標(振り返り)。/plans/{plan_id}/journey配下。
app.include_router(journey.router, prefix="/api/v1")
# [Gate P15] FR-052 Personal Travel Atlas(旅行を横断した訪問地域。本人だけ)。/atlas配下。
app.include_router(atlas.router, prefix="/api/v1")
# [Gate V2] FR-049〜051 訪問の地図の層・訪問の判定と信頼度・訂正と非表示(本人だけ)。/plans/{plan_id}/visits配下。
app.include_router(visits.router, prefix="/api/v1")
# [Gate C2] FR-007 候補箱(/plans/{plan_id}/candidates)・FR-008 場所の一元管理(/places・/plans/{plan_id}/places)。
app.include_router(candidates.router, prefix="/api/v1")
app.include_router(places.router, prefix="/api/v1")
# [Gate C3] FR-009 情報内検索・コマンドパレット(/plans/{plan_id}/search・/search/everything)。
app.include_router(plan_search.plan_router, prefix="/api/v1")
app.include_router(plan_search.global_router, prefix="/api/v1")
# [Gate P17] FR-057 Memory Replan(過去の予定と実績から次の旅行への提案)。/plans/{plan_id}/memory-replan配下。
app.include_router(memory_replan.router, prefix="/api/v1")
# [Gate K1] B-008 オフラインパックの鍵の配布と失効(利用者ごと・版ごとに導出。DBには版だけ)。/offline-pack配下。
app.include_router(offline_pack.router, prefix="/api/v1")
# [Gate C1] FR-020 共同編集(同じ旅行を開いている人・編集中・他の人の変更)。/plans/{plan_id}/presence配下。
app.include_router(presence.router, prefix="/api/v1")
# [Gate C1] FR-023 秘匿プロフィール(本人だけ)。/privacy/private-profile・/plans/{plan_id}/private-profile。
app.include_router(private_profile.profile_router, prefix="/api/v1")
app.include_router(private_profile.plan_router, prefix="/api/v1")
# [Gate B1] FR-041 組織・B2B / FR-042 外部連携(OAuth client_credentials・Webhook)
app.include_router(organizations.router, prefix="/api/v1")
app.include_router(org_external.router, prefix="/api/v1")


@app.exception_handler(org_external.ApiError)
async def _org_api_error(request: Request, exc: org_external.ApiError):
    response = org_external.api_error_response(exc)
    apply_security_headers(request.url.path, response.headers)
    return response
