"""[Gate S9] 新しい端末からのログインを本人に知らせる(アカウントの乗っ取りに早く気付けるように)。

AI を使った攻撃は、漏れたパスワードの組を大量に試し(パスワードリスト攻撃)、当たったアカウントへ静かに入る。
本人が気付かなければ、旅程・予約・文書を見られ続ける。ここでは、ログインした端末(ブラウザと OS の組)が
過去90日のどのセッションとも違う時に、本人へ通知を作る(初めてのログインでは作らない)。

- 端末の名前は User-Agent から大まかに作る(「Chrome / Windows」など。版や細かい識別子は残さない)
- 接続元は IPv4 は /24、IPv6 は /48 に丸めて表示する(本人のデータだが、通知に完全な IP を残さない)
- 通知は既存の通知(notifications)に入れる。メール送信は無い(SMTP の設定が無いため)

限界: 同じブラウザと OS の組を使う攻撃者は「新しい端末」にならない。ログイン中の端末の一覧(設定 → セキュリティ)で
確かめられるようにしている。
"""
from __future__ import annotations

import ipaddress
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

KNOWN_DAYS = 90

_BROWSERS = (
    ("Edge", re.compile(r"Edg(e|A|iOS)?/")),
    ("Opera", re.compile(r"OPR/|Opera")),
    ("Samsung Internet", re.compile(r"SamsungBrowser/")),
    ("Firefox", re.compile(r"Firefox/|FxiOS/")),
    ("Chrome", re.compile(r"Chrome/|CriOS/")),
    ("Safari", re.compile(r"Safari/")),
)
_SYSTEMS = (
    ("iPhone", re.compile(r"iPhone")),
    ("iPad", re.compile(r"iPad")),
    ("Android", re.compile(r"Android")),
    ("ChromeOS", re.compile(r"CrOS")),
    ("Windows", re.compile(r"Windows")),
    ("macOS", re.compile(r"Macintosh|Mac OS X")),
    ("Linux", re.compile(r"Linux")),
)


def device_label(user_agent: Optional[str]) -> str:
    ua = user_agent or ""
    browser = next((name for name, pattern in _BROWSERS if pattern.search(ua)), None)
    system = next((name for name, pattern in _SYSTEMS if pattern.search(ua)), None)
    if not browser and not system:
        return "不明な端末"
    return f"{browser or 'ブラウザ'} / {system or '不明なOS'}"


def network_label(ip: Optional[str]) -> Optional[str]:
    """接続元を丸めた表示(203.0.113.x / 2001:db8:1::/48)。"""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if addr.version == 4:
        parts = str(addr).split(".")
        return ".".join(parts[:3]) + ".x"
    network = ipaddress.ip_network(f"{addr}/48", strict=False)
    return str(network)


def session_device_info(user_agent: Optional[str]) -> dict:
    """セッションに保存する端末の情報(User-Agent は従来どおり255文字まで)。"""
    return {"user_agent": (user_agent or "")[:255], "device": device_label(user_agent)}


def _label_of(session) -> str:
    info = session.device_info or {}
    return str(info.get("device") or device_label(info.get("user_agent")))


def is_new_device(db, user_id, label: str, *, exclude_session_id=None, now: Optional[datetime] = None) -> bool:
    """過去 KNOWN_DAYS 日のセッションに同じ端末が無ければ True。セッションが1つも無ければ(初めて)False。"""
    from app.models.models import UserSession

    now = now or datetime.now(timezone.utc)
    query = db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.created_at >= now - timedelta(days=KNOWN_DAYS),
    )
    if exclude_session_id is not None:
        query = query.filter(UserSession.id != exclude_session_id)
    previous = query.all()
    if not previous:
        return False
    return all(_label_of(s) != label for s in previous)


def notify_if_new_device(db, user, session, *, user_agent: Optional[str], ip: Optional[str]) -> bool:
    """新しい端末なら本人に通知を作る(commit する)。作ったら True。失敗してもログインは止めない。"""
    from app.models.models import Notification

    try:
        label = device_label(user_agent)
        if not is_new_device(db, user.id, label, exclude_session_id=session.id):
            return False
        network = network_label(ip)
        where = f"(接続元 {network})" if network else ""
        db.add(Notification(
            id=uuid.uuid4(), user_id=user.id, type="new_device_login",
            title="新しい端末からログインがありました",
            message=(f"{label}{where}からログインがありました。心当たりが無い場合は、設定 → セキュリティの"
                     "「ログイン中の端末」でその端末をログアウトさせ、パスワードを変更してください。"),
        ))
        db.commit()
        return True
    except Exception:  # noqa: BLE001 - 通知の失敗でログインを止めない
        db.rollback()
        return False
