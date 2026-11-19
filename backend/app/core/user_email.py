"""[Gate②] メールアドレスで会員を探す・重複を確かめる(大文字小文字を区別しない)。

以前はログイン・登録・ゲストの昇格・メールの変更などが `User.email == 入力` で比べていた。登録時のメールは
pydantic の正規化でドメインだけが小文字になり、ローカル部は入力のまま残る。そのため「Taro@example.com」で登録した人が
「taro@example.com」と打つとログインできず、大文字小文字だけ違う 2 つ目のアカウントも作れていた
(パスワードの再設定 `account_recovery.py` だけは既に func.lower で比べていた)。

- 探す: まず完全一致。無ければ大文字小文字を区別しない一致が **1 件だけ** の時に、その人とする
  (既に大文字小文字だけ違う 2 つのアカウントがある時は、どちらか分からないので完全一致だけを使う)
- 重複: 大文字小文字を区別せず、誰かが使っていれば使用中
保存の値は書き換えない(既存のデータの移行はしない)。
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import User


def email_key(email: Any) -> str:
    return str(email or "").strip().lower()


def find_user_by_email(db: Session, email: Any, *criteria: Any) -> Optional[User]:
    raw = str(email or "").strip()
    if not raw:
        return None
    exact = db.query(User).filter(User.email == raw, *criteria).first()
    if exact is not None:
        return exact
    rows = db.query(User).filter(func.lower(User.email) == email_key(raw), *criteria).limit(2).all()
    return rows[0] if len(rows) == 1 else None


def email_in_use(db: Session, email: Any, exclude_user_id: Any = None) -> bool:
    key = email_key(email)
    if not key:
        return False
    q = db.query(User.id).filter(func.lower(User.email) == key)
    if exclude_user_id is not None:
        q = q.filter(User.id != exclude_user_id)
    return q.first() is not None
