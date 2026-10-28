"""[Gate G10-Q] 品質の再監査(V3)の回帰試験。

- ORM の定義(SQLAlchemy 2.0 の Mapped[...] / mapped_column へ移した)と、migration で作った DB の列・型・NULL の可否が
  一致すること(移行で DDL を変えていないことの証拠。索引は migration だけで作るものがあるため比べない)
- 呼び出し元が無く、import するだけで失敗するもの・呼べば必ず失敗するもの(ghost code)を消したこと
- 型の検査で見つかった None の扱いの漏れ(パスワードの無い利用者・名前の無い利用者・時刻の読めない軌跡の点)
"""
import importlib
import importlib.util
from datetime import datetime, timezone

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.core.database import Base, engine
import app.models.models  # noqa: F401 - 全ての表を Base.metadata に登録する

# ---------------------------------------------------------------- ORM と DB の一致


def _flatten(diff):
    out = []
    for d in diff:
        out.extend(d if isinstance(d, list) else [d])
    return out


def test_orm_columns_match_migrated_database():
    """列の追加・削除・型・NULL の可否・表の差が 0(以前の Column() 宣言と同じ DDL のまま)。"""
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True, "compare_server_default": False})
        diff = _flatten(compare_metadata(ctx, Base.metadata))
    # migration だけで作った索引(外部キーの索引など)は ORM に書いていないため、"remove_index" だけは許す
    unexpected = [d for d in diff if d[0] != "remove_index"]
    assert unexpected == [], unexpected[:10]


def test_models_use_typed_mapped_columns():
    """全ての列が Mapped[...] の注釈つき(型の検査で値の型・None の可否が分かる)。"""
    from app.models.models import TravelPlan, User

    assert "Mapped" in str(User.__annotations__["email"])
    assert "Optional" in str(User.__annotations__["email"])  # DB で NULL を許す列は Optional
    assert "Optional" not in str(TravelPlan.__annotations__["id"])  # 主キーは NULL にならない
    # 既定値つきの列は DB で NULL を許したまま(nullable=True を明示)、型は値ありとして扱う
    assert User.__table__.c.created_at.nullable is True
    assert "Optional" not in str(User.__annotations__["created_at"])


# ---------------------------------------------------------------- 消した ghost code

REMOVED_MODULES = [
    "app.schemas.schemas",   # pydantic v2 で廃止の regex= を使い、import した瞬間に TypeError
    "app.schemas.travel",
    "app.schemas.common",
    "app.schemas.auth",
    "app.schemas.user",
    "app.crud.user",
    "app.utils.helpers",
    "app.services.notification",  # send_email の引数が合わず・存在しない設定を読む(実際の送信は notify.py)
]


@pytest.mark.parametrize("name", REMOVED_MODULES)
def test_dead_modules_removed(name):
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(name)


def test_broken_auth_manager_methods_removed():
    """create_session を誤った引数で呼んでいた旧ログイン系は消した(実際のログインは api/v1/auth.py)。"""
    from app.core.auth import AuthManager

    for name in ("login_user", "logout_user", "refresh_token", "create_guest_session", "extend_session",
                 "validate_password_strength"):
        assert not hasattr(AuthManager, name), name


def test_broken_logging_helpers_removed():
    """Settings に無い設定(ENVIRONMENT・LOG_JSON_FORMAT・LOG_DIR)を読む関数は消した。"""
    import app.core.logging as lg

    for name in ("log_system_event", "get_log_stats", "cleanup_old_logs"):
        assert not hasattr(lg, name)
        assert name not in lg.__all__


def test_validators_keep_only_used_constants():
    import app.utils.validators as v

    assert ".pdf" in v.ALLOWED_DOCUMENT_EXTENSIONS and ".jpg" in v.ALLOWED_IMAGE_EXTENSIONS
    assert not hasattr(v, "validate_username")


# ---------------------------------------------------------------- None の扱い


def test_verify_password_rejects_missing_hash():
    from app.api.v1.auth import hash_password, verify_password
    from app.core.auth import auth_manager

    assert verify_password("anything", None) is False
    assert auth_manager.verify_password("anything", None) is False
    assert verify_password("secret-123", hash_password("secret-123")) is True


def test_user_response_tolerates_null_name_and_email():
    """DB で名前・メールが NULL の利用者でも応答を作れる(以前は UserResponse の検証で 500 になり得た)。"""
    import uuid

    from app.api.v1.auth import _user_response
    from app.models.models import User

    u = User(id=uuid.uuid4(), username=None, email=None, user_type="registered", is_verified=None)
    r = _user_response(u)
    assert r.username == "" and r.email == "" and r.is_verified is False and r.user_type == "registered"


def test_split_range_keeps_points_with_unreadable_time():
    """時刻の読めない点は範囲に入らない(以前は None との比較で TypeError)。"""
    from app.services.location_tracks import split_range

    start = datetime(2026, 10, 1, 9, tzinfo=timezone.utc)
    end = datetime(2026, 10, 1, 10, tzinfo=timezone.utc)
    points = [{"t": "2026-10-01T09:30:00+00:00"}, {"t": "not-a-time"}, {"t": "2026-10-01T11:00:00+00:00"}]
    keep, removed = split_range(points, start, end)
    assert removed == 1 and [p["t"] for p in keep] == ["not-a-time", "2026-10-01T11:00:00+00:00"]


def test_security_headers_accept_plain_dict():
    from app.core.security_headers import apply_security_headers

    h = {"X-Frame-Options": "SAMEORIGIN"}
    apply_security_headers("/api/v1/plans", h)
    assert h["X-Frame-Options"] == "SAMEORIGIN"  # 付いている値は上書きしない
    assert h["X-Content-Type-Options"] == "nosniff" and "Content-Security-Policy" in h


# ---------------------------------------------------------------- 性能(毎晩の perf の失敗の修正)


def test_prune_old_validation_runs_is_bulk(db_session, make_user):
    """古い判定の記録は1文で消え、その指摘は DB の連鎖で消える(以前は指摘を全て読み込んで1行ずつ消していた)。"""
    import uuid as _uuid
    from datetime import timedelta

    from sqlalchemy import event as sa_event

    from app.api.v1.validation import MAX_RUNS_PER_PLAN, _prune_old_runs
    from app.models.models import TravelPlan, ValidationIssue, ValidationRun

    owner, _ = make_user()
    plan = TravelPlan(id=_uuid.uuid4(), user_id=owner.id, title="G10 判定の記録", revision=1)
    db_session.add(plan)
    db_session.flush()
    base = datetime(2026, 10, 1, tzinfo=timezone.utc)
    runs = []
    for i in range(MAX_RUNS_PER_PLAN + 2):
        r = ValidationRun(id=_uuid.uuid4(), plan_id=plan.id, created_by_user_id=owner.id, input_revision=1,
                          input_fingerprint="f", algorithm_version="v", status="completed", summary_json={},
                          started_at=base + timedelta(minutes=i), created_at=base + timedelta(minutes=i))
        runs.append(r)
        db_session.add(r)
    db_session.flush()
    oldest = runs[0]
    db_session.add_all([ValidationIssue(id=_uuid.uuid4(), run_id=oldest.id, sort_order=n, code="X", kind="violation",
                                        severity="WARNING", message="m") for n in range(50)])
    db_session.flush()
    db_session.expunge_all()

    statements = []

    def before(conn, cursor, statement, params, context, executemany):
        if not statement.lstrip().upper().startswith(("SAVEPOINT", "RELEASE", "ROLLBACK")):
            statements.append(statement)

    sa_event.listen(engine, "before_cursor_execute", before)
    try:
        _prune_old_runs(db_session, plan.id)
        db_session.flush()
    finally:
        sa_event.remove(engine, "before_cursor_execute", before)
    assert len(statements) == 2, statements  # 消す記録の id を選ぶ・まとめて消す
    left = db_session.query(ValidationRun).filter(ValidationRun.plan_id == plan.id).count()
    assert left == MAX_RUNS_PER_PLAN
    assert db_session.query(ValidationIssue).filter(ValidationIssue.run_id == oldest.id).count() == 0


# ---------------------------------------------------------------- V3 再監査(台帳と証拠の突き合わせ)


def test_v3_audit_rules_hold():
    """scripts/ci/audit_v3.py の R1〜R8(VERIFIED と台帳・(部分)・E2E の印と spec・不足の記載)を全て満たす。"""
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    script = root / "scripts" / "ci" / "audit_v3.py"
    if not (root / "frontend" / "e2e").is_dir():
        pytest.skip("リポジトリの根が無い(backend コンテナの中)")
    spec = importlib.util.spec_from_file_location("audit_v3", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    summary, problems = mod.audit()
    assert problems == [], problems
    assert summary["total"] == 58
    assert summary["counts"].get("RELEASED", 0) == 0
