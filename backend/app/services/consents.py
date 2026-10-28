"""
[Gate P9] FR-039・DOC-11 §15「Consent withdrawal: AI、位置、分析、メールを目的別停止」の同意台帳。

- 目的ごとに 同意する/しない と更新日時を users.preferences["privacy_consents"] に保存する(migrationなし)。
- 既定は全て「同意しない」(DOC-11 §23 Privacy by Default)。
- 処理を行う機能がある目的は in_use=True。処理の前に has_consent() を確認し、撤回後は新たな処理をしないこと
  (ADR-account-deletion.md §4)。[Gate P13] location は位置の軌跡(FR-038)で使い、撤回すると記録中の軌跡を止める。
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.models import User

KEY = "privacy_consents"
PURPOSES: List[Dict[str, Any]] = [
    {"purpose": "ai_processing", "label": "AIによる文書・候補の処理",
     "description": "予約メールや文書の読み取り、旅程案の作成に外部のAIを使うこと。", "in_use": False},
    {"purpose": "location", "label": "位置情報の利用",
     "description": "旅の記録のために位置の軌跡を記録すること(旅行ごとに自分で開始・停止でき、本人だけが見られます)。",
     "in_use": True},
    {"purpose": "analytics", "label": "利用状況の分析",
     "description": "サービス改善のため、操作の記録を個人を特定しない形で集計すること。", "in_use": False},
    {"purpose": "marketing_email", "label": "お知らせのメール",
     "description": "新機能やキャンペーンのお知らせをメールで送ること(旅行の通知とは別です)。", "in_use": False},
]
PURPOSE_KEYS = [p["purpose"] for p in PURPOSES]


def _stored(user: User) -> Dict[str, Any]:
    raw = (user.preferences or {}).get(KEY)
    return raw if isinstance(raw, dict) else {}


def has_consent(user: User, purpose: str) -> bool:
    entry = _stored(user).get(purpose)
    return bool(isinstance(entry, dict) and entry.get("granted") is True)


def view(user: User) -> Dict[str, Any]:
    stored = _stored(user)
    out = []
    for p in PURPOSES:
        found = stored.get(p["purpose"])
        entry: Dict[str, Any] = found if isinstance(found, dict) else {}
        out.append({**p, "granted": entry.get("granted") is True, "updated_at": entry.get("updated_at")})
    return {"purposes": out}


def update(user: User, changes: Dict[str, bool], now: Optional[datetime] = None) -> List[str]:
    """変更された目的の一覧を返す。呼出側でcommitする。"""
    now = now or datetime.now(timezone.utc)
    stored = dict(_stored(user))
    changed = []
    for purpose, granted in changes.items():
        if has_consent(user, purpose) == granted and purpose in stored:
            continue
        stored[purpose] = {"granted": granted, "updated_at": now.isoformat()}
        changed.append(purpose)
    prefs = dict(user.preferences or {})
    prefs[KEY] = stored
    user.preferences = prefs
    return changed
