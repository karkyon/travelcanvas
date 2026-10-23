"""
[Gate C1] FR-023 秘匿プロフィール・制約(DOC-02「予算、健康、宗教、食事、体力等を本人限定で保存できる。
他の参加者には『必要条件を満たした/満たさない』のみ表示できる。運用管理者にも平文を常時見せない」)。

利用者は旅行をまたいで使う非公開の条件(プロフィール)を一度だけ登録し、旅行ごとに「この旅行に適用する」を選ぶ。
適用した旅行には、項目ごとに **秘匿制約**(Gate L2 の constraints、privacy_level=private)を本人の名で作る。
判定(実行可能性検証 L3・並べ替え L4)は秘匿制約として扱い、他の参加者には「秘匿制約を満たしていません」等だけを出す
(題名・値・根拠の値は出さない。feasibility.py の _violation)。

- 保存: 項目の一覧を JSON にして Fernet で暗号化した1つの値だけ(user_private_profiles.items_ciphertext)。
  題名(例: 「朝はゆっくりしたい」)も値も平文の列に置かない。監査には件数だけを残す。
- 適用中の旅行(private_profile_links)は、プロフィールを変えるたびに秘匿制約を作り直す(項目の ID で対応付け)。
- プロフィールから作った秘匿制約は、制約の画面からは変えられない(プロフィールで変えるか、適用をやめる)。
- 項目の種類と、判定に使う制約の対応(判定できる種類だけを用意する。「検証不能を問題なしにしない」FR-017):
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload, user_subject
from app.models.models import PlanConstraint, PrivateProfileLink, UserPrivateProfile

MAX_ITEMS = 20
MAX_LABEL = 60
DEFAULT_SOFT_WEIGHT = 50
CURRENCIES = ("JPY", "USD", "EUR")  # feasibility.CURRENCY_UNITS と同じ(判定できる通貨だけ)

# kind → (制約の種類, 演算子, 適用範囲, 値の型, 使える単位)
KINDS: Dict[str, Tuple[str, str, str, str, Tuple[str, ...]]] = {
    "earliest_start": ("preference", "after", "member", "time", ()),        # 予定はこの時刻より後に始める
    "latest_end": ("preference", "before", "member", "time", ()),           # 予定はこの時刻より前に終える
    "daily_travel_max": ("fatigue", "max", "member", "number", ("minutes", "hours", "km")),  # 1日の移動の上限
    "meal_interval_max": ("meal_interval", "max", "member", "number", ("minutes", "hours")),  # 食事の間隔の上限
    "trip_budget_max": ("budget_limit", "max", "plan", "number", CURRENCIES),  # 旅行全体の予算の上限
    "avoid_text": ("forbidden", "avoid", "member", "text", ()),             # 予定に含まれていてほしくない語
    "avoid_transport": ("avoid_transport", "avoid", "member", "text", ()),  # 避けたい移動手段
}
KIND_LABEL = {
    "earliest_start": "開始が早すぎない", "latest_end": "終わりが遅すぎない", "daily_travel_max": "1日の移動の上限",
    "meal_interval_max": "食事の間隔", "trip_budget_max": "旅行の予算の上限", "avoid_text": "避けたいこと",
    "avoid_transport": "避けたい移動手段",
}
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


# ---------------------------------------------------------------- 項目の検査(純粋関数)

def clean_item(raw: Dict[str, Any]) -> Dict[str, Any]:
    """1つの項目を検査して正規化する。不正なら 422。"""
    if not isinstance(raw, dict):
        raise _bad("invalid_item", "項目の形式が不正です")
    kind = raw.get("kind")
    if kind not in KINDS:
        raise _bad("invalid_kind", "条件の種類が不正です")
    _ctype, _op, _scope, vtype, units = KINDS[kind]
    label = raw.get("label")
    if not isinstance(label, str) or not label.strip() or len(label.strip()) > MAX_LABEL:
        raise _bad("invalid_label", f"名前は1〜{MAX_LABEL}文字で入力してください")
    hardness = raw.get("hardness", "hard")
    if hardness not in ("hard", "soft"):
        raise _bad("invalid_hardness", "必ず守る/できれば を選んでください")
    item_id = raw.get("id") or str(uuid.uuid4())
    try:
        item_id = str(uuid.UUID(str(item_id)))
    except ValueError:
        raise _bad("invalid_item", "項目の ID が不正です")
    value = raw.get("value")
    unit = raw.get("unit")
    if vtype == "time":
        if not isinstance(value, str) or not _HHMM.match(value):
            raise _bad("invalid_value", "時刻は HH:MM で入力してください")
        unit = None
    elif vtype == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 10_000_000:
            raise _bad("invalid_value", "0以上の数で入力してください")
        if unit not in units:
            raise _bad("invalid_unit", "単位を選んでください")
    else:
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 200:
            raise _bad("invalid_value", "1〜200文字で入力してください")
        value = value.strip()
        unit = None
    return {"id": item_id, "kind": kind, "label": label.strip(), "hardness": hardness, "value": value, "unit": unit}


def clean_items(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        raise _bad("invalid_items", "items は一覧で指定してください")
    if len(raw_items) > MAX_ITEMS:
        raise _bad("too_many_items", f"条件は{MAX_ITEMS}件までです")
    items = [clean_item(r) for r in raw_items]
    if len({i["id"] for i in items}) != len(items):
        raise _bad("duplicate_item", "同じ項目が2回あります")
    return items


def constraint_spec(item: Dict[str, Any], user_id: uuid.UUID) -> Dict[str, Any]:
    """項目から作る秘匿制約の中身(純粋関数)。"""
    ctype, operator, scope, _vtype, _units = KINDS[item["kind"]]
    return {
        "constraint_type": ctype, "operator": operator, "hardness": item["hardness"],
        "weight": None if item["hardness"] == "hard" else DEFAULT_SOFT_WEIGHT,
        "scope_type": scope, "scope_id": user_id if scope == "member" else None,
        "title": item["label"],
        "value": {"value": item["value"], "value_to": None, "unit": item["unit"]},
    }


# ---------------------------------------------------------------- 保存

def _encrypt(items: List[Dict[str, Any]], user_id) -> bytes:
    try:
        # [Gate G3] SEC-F5 利用者のデータ鍵(アカウントの削除で鍵を破棄する)
        return encrypt_payload(json.dumps({"v": 1, "items": items}, ensure_ascii=False).encode("utf-8"),
                               user_subject(user_id))
    except EncryptionNotConfigured:
        raise _bad("encryption_unavailable", "暗号化が設定されていないため保存できません", 503)


def decrypt_items(row: Optional[UserPrivateProfile]) -> Optional[List[Dict[str, Any]]]:
    """復号した項目の一覧。行が無ければ []、復号できなければ None。"""
    if row is None:
        return []
    try:
        data = json.loads(decrypt_payload(row.items_ciphertext).decode("utf-8"))
    except (EncryptionNotConfigured, ValueError):
        return None
    items = data.get("items") if isinstance(data, dict) else None
    return items if isinstance(items, list) else None


def get_profile(db: Session, user_id) -> Optional[UserPrivateProfile]:
    return db.query(UserPrivateProfile).filter(UserPrivateProfile.user_id == user_id).first()


def save_profile(db: Session, user_id, items: List[Dict[str, Any]], expected_revision: int) -> UserPrivateProfile:
    row = get_profile(db, user_id)
    current = row.revision if row else 0
    if expected_revision != current:
        raise _bad("revision_mismatch", "ほかの画面で変更されました。読み込み直してください", 409)
    if row is None:
        row = UserPrivateProfile(user_id=user_id, items_ciphertext=_encrypt(items, user_id), revision=1)
        db.add(row)
    else:
        row.items_ciphertext = _encrypt(items, user_id)
        row.revision += 1
    db.flush()
    return row


def linked_plan_ids(db: Session, user_id) -> List[uuid.UUID]:
    return [r[0] for r in db.query(PrivateProfileLink.plan_id).filter(PrivateProfileLink.user_id == user_id).all()]


def is_linked(db: Session, plan_id, user_id) -> bool:
    return db.query(PrivateProfileLink).filter(PrivateProfileLink.plan_id == plan_id,
                                               PrivateProfileLink.user_id == user_id).first() is not None


def derived_constraints(db: Session, plan_id, user_id) -> List[PlanConstraint]:
    return (db.query(PlanConstraint).filter(
        PlanConstraint.plan_id == plan_id, PlanConstraint.owner_user_id == user_id,
        PlanConstraint.profile_item_id.isnot(None), PlanConstraint.deleted_at.is_(None)).all())


def sync_plan(db: Session, plan_id, user_id, items: List[Dict[str, Any]],
              now: Optional[datetime] = None) -> Dict[str, int]:
    """適用中の旅行の秘匿制約を、プロフィールの項目に合わせて作り直す(項目の ID で対応付け)。commit は呼出側。"""
    from app.api.v1.constraints import _store_payload  # 暗号化の形を制約の API と同じにする

    now = now or datetime.now(dt_timezone.utc)
    existing = {c.profile_item_id: c for c in derived_constraints(db, plan_id, user_id)}
    created = updated = removed = 0
    wanted = set()
    for item in items:
        spec = constraint_spec(item, user_id)
        wanted.add(item["id"])
        c = existing.get(item["id"])
        if c is None:
            c = PlanConstraint(id=uuid.uuid4(), plan_id=plan_id, owner_user_id=user_id, profile_item_id=item["id"],
                               is_active=True, revision=1)
            db.add(c)
            created += 1
        else:
            c.revision += 1
            updated += 1
        for key in ("constraint_type", "operator", "hardness", "weight", "scope_type", "scope_id"):
            setattr(c, key, spec[key])
        c.is_active = True
        _store_payload(c, "private", spec["title"], spec["value"])
    for item_id, c in existing.items():
        if item_id not in wanted:
            c.deleted_at = now
            c.revision += 1
            removed += 1
    db.flush()
    return {"created": created, "updated": updated, "removed": removed}


def unlink_plan(db: Session, plan_id, user_id, now: Optional[datetime] = None) -> int:
    now = now or datetime.now(dt_timezone.utc)
    n = 0
    for c in derived_constraints(db, plan_id, user_id):
        c.deleted_at = now
        c.revision += 1
        n += 1
    db.query(PrivateProfileLink).filter(PrivateProfileLink.plan_id == plan_id,
                                        PrivateProfileLink.user_id == user_id).delete(synchronize_session=False)
    db.flush()
    return n


def delete_for_user(db: Session, user_id) -> None:
    """アカウントの削除: プロフィール・適用の記録・プロフィールから作った秘匿制約を消す。commit は呼出側。"""
    now = datetime.now(dt_timezone.utc)
    for plan_id in linked_plan_ids(db, user_id):
        unlink_plan(db, plan_id, user_id, now)
    db.query(UserPrivateProfile).filter(UserPrivateProfile.user_id == user_id).delete(synchronize_session=False)
