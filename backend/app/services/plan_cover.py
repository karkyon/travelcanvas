"""[Gate G11] 旅行の表紙の写真・予定の写真(docs/ux/G11_UIUX全範囲_実装仕様.md §1・§2)。

- 表紙・予定の写真は同じ旅行の kind=photo の記録(Memory)を指す。記録の公開範囲は変えない
- 見えるかどうかは記録の規則と同じ(書いた本人か、メンバーに公開された記録)。見えない人には表紙の情報を返さない
  (存在も知らせない。画面はグラデーションの表紙になる)
- 記録が消えると外部キー(ON DELETE SET NULL)で参照が外れる
"""
import uuid
from typing import Any, Dict, Iterable, Optional

from sqlalchemy.orm import Session

from app.models.models import Memory, TravelPlan, User

FOCUS_MIN, FOCUS_MAX = 0, 100
ZOOM_MIN, ZOOM_MAX = 100, 300


class CoverInputError(ValueError):
    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def visible_to(m: Memory, user: User) -> bool:
    return m.author_user_id == user.id or m.visibility == "members"


def check_position(focus_x: Optional[int], focus_y: Optional[int], zoom: Optional[int]) -> None:
    for label, v, lo, hi in (("横の位置", focus_x, FOCUS_MIN, FOCUS_MAX), ("縦の位置", focus_y, FOCUS_MIN, FOCUS_MAX),
                             ("拡大", zoom, ZOOM_MIN, ZOOM_MAX)):
        if v is None:
            continue
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            raise CoverInputError("invalid_field", f"{label}は{lo}〜{hi}の整数で指定してください")


def photo_for(db: Session, plan: TravelPlan, memory_id: Any, user: User) -> Memory:
    """表紙・予定の写真に使える記録(同じ旅行・写真・本人に見える)。使えなければ CoverInputError(存在を漏らさない)"""
    try:
        mid = memory_id if isinstance(memory_id, uuid.UUID) else uuid.UUID(str(memory_id))
    except (ValueError, TypeError):
        raise CoverInputError("invalid_field", "写真の ID の形式が不正です")
    m = db.query(Memory).filter(Memory.id == mid, Memory.plan_id == plan.id).first()
    if m is None or not visible_to(m, user):
        raise CoverInputError("photo_not_found", "指定した写真が見つかりません", 404)
    if m.kind != "photo" or not m.storage_key:
        raise CoverInputError("not_a_photo", "表紙に使えるのは写真の記録だけです")
    return m


def source_summary(m: Memory) -> Optional[Dict[str, Any]]:
    """外部の写真の出典(表示に要るものだけ)。手で上げた写真は None"""
    src = m.source if isinstance(m.source, dict) else None
    if not src:
        return None
    keys = ("kind", "provider", "author", "license", "license_url", "attribution", "source_page_url", "retrieved_at",
            "modified")
    return {k: src.get(k) for k in keys if src.get(k) is not None}


def cover_dict(plan: TravelPlan, m: Optional[Memory], user: User) -> Optional[Dict[str, Any]]:
    if plan.cover_memory_id is None or m is None or m.id != plan.cover_memory_id or not visible_to(m, user):
        return None
    return {
        "memory_id": str(m.id), "focus_x": plan.cover_focus_x, "focus_y": plan.cover_focus_y,
        "zoom": plan.cover_zoom, "visibility": m.visibility, "by_me": m.author_user_id == user.id,
        "source": source_summary(m), "revision": m.revision,
    }


def covers_for(db: Session, plans: Iterable[TravelPlan], user: User) -> Dict[Any, Optional[Dict[str, Any]]]:
    """複数の旅行の表紙をまとめて引く(一覧・ダッシュボード用。1回の問い合わせ)"""
    plans = list(plans)
    ids = [p.cover_memory_id for p in plans if p.cover_memory_id is not None]
    rows: Dict[Any, Memory] = {}
    if ids:
        rows = {m.id: m for m in db.query(Memory).filter(Memory.id.in_(ids)).all()}
    return {p.id: cover_dict(p, rows.get(p.cover_memory_id), user) if p.cover_memory_id else None for p in plans}


def cover_of(db: Session, plan: TravelPlan, user: User) -> Optional[Dict[str, Any]]:
    return covers_for(db, [plan], user)[plan.id]


def cover_memory(db: Session, plan: TravelPlan, user: User) -> Optional[Memory]:
    """表紙の写真の記録(見える時だけ)"""
    if plan.cover_memory_id is None:
        return None
    m = db.query(Memory).filter(Memory.id == plan.cover_memory_id, Memory.plan_id == plan.id).first()
    if m is None or not visible_to(m, user) or m.kind != "photo" or not m.storage_key:
        return None
    return m
