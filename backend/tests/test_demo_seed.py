"""ダミーデータの登録(scripts/demo_seed.py)と、完全に元へ戻せることの試験。"""
import argparse
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.database import SessionLocal
from app.models.models import User

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import demo_seed  # noqa: E402


def _snapshot():
    """全テーブルの行の内容の指紋(alembic_version を除く)。"""
    db = SessionLocal()
    try:
        tables = [r[0] for r in db.execute(text("select tablename from pg_tables where schemaname = 'public'"))]
        return {
            t: db.execute(
                text(f"""select count(*), md5(coalesce(string_agg(x, '' order by x), ''))
                     from (select md5(row(a.*)::text) x from "{t}" a) z""")
            ).one()
            for t in tables
            if t != "alembic_version"
        }
    finally:
        db.close()


def _make_owner():
    db = SessionLocal()
    try:
        email = f"seed_owner_{uuid.uuid4().hex[:10]}@example.com"
        db.add(User(email=email, username=email.split("@")[0], is_active=True, is_verified=True, user_type="registered"))
        db.commit()
        return email
    finally:
        db.close()


def test_seed_then_reset_restores_every_table():
    email = _make_owner()
    before = _snapshot()
    code = demo_seed.cmd_seed(argparse.Namespace(owner_email=email, companion_password=None))
    try:
        assert code == 0
        db = SessionLocal()
        rows = db.execute(
            text("select title, status from travel_plans where preferences::jsonb ? 'tc_demo_seed' order by start_date")
        ).fetchall()
        db.close()
        assert len(rows) == 5
        assert [r[1] for r in rows].count("completed") == 4
    finally:
        assert demo_seed.cmd_reset(argparse.Namespace(yes=True)) == 0
    after = _snapshot()
    assert {k: (before[k], after[k]) for k in before if before[k] != after[k]} == {}
    db = SessionLocal()
    db.query(User).filter(User.email == email).delete()
    db.commit()
    db.close()


def test_seed_refuses_production(monkeypatch):
    env = {"settings": type("S", (), {"APP_ENV": "production"})()}
    with pytest.raises(demo_seed.SeedError):
        demo_seed._guard_environment(env)
