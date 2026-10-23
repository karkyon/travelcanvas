"""[Gate G5] ORG-01 組織のロゴ・独自のドメインの所有の確認・席の上限。

ロゴ:
- 受け取るのは PNG・JPEG・WebP(中身で判定。拡張子・Content-Type は信じない)、MAX_LOGO_BYTES まで、
  縦横 MAX_LOGO_PIXELS まで(画像の爆弾を開かない)。ウイルス検査(malware_scan)を通した後、Pillow で読み直して
  縦横 OUTPUT_SIZE 以内の PNG に作り直す(EXIF・色の設定・埋め込み・アニメーションの2枚目以降は残らない)。
- 保存は organizations.logo_png(DB。保存ファイルの暗号化・鍵の点検の対象の外に置かない)。配信はメンバーだけ
  (nosniff・private キャッシュ・sha256 の ETag)。

ドメイン:
- 登録すると token を作る。DNS の TXT ``_travelcanvas.<domain>`` に ``travelcanvas-verify=<token>`` を置いてもらい、
  確認で引いて一致すれば verified。確認済みのドメインは1つの組織だけ(DB の一意の索引)。
- 引く処理は resolve_txt(試験で差し替える)。名前解決の失敗・時間切れは failed と理由だけを残す。

席:
- seat_limit(NULL は上限なし)。メンバーを足す時に今の人数 >= 上限なら 409 seat_limit_reached。
  上限を今の人数より下げることはできない(409 seat_limit_below_members)。参加・脱退・上限の変更を席の記録に残す。
"""
import hashlib
import io
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import OrganizationMember, OrganizationSeatEvent

MAX_LOGO_BYTES = 1024 * 1024
MAX_LOGO_PIXELS = 4096
OUTPUT_SIZE = 512
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
TXT_PREFIX = "_travelcanvas"
TXT_VALUE = "travelcanvas-verify="
MAX_DOMAINS = 10
_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


class BrandingError(ValueError):
    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code, self.status_code = code, status_code


# ===== ロゴ

def sanitize_logo(content: bytes) -> Tuple[bytes, str]:
    """検査して PNG に作り直す。戻り値は (PNG の bytes, sha256)。"""
    if not content:
        raise BrandingError("logo_empty", "画像を選んでください")
    if len(content) > MAX_LOGO_BYTES:
        raise BrandingError("logo_too_large", f"ロゴは{MAX_LOGO_BYTES // 1024}KBまでです", 413)
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(content)) as probe:
            fmt = probe.format
            w, h = probe.size
            probe.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise BrandingError("logo_invalid", "PNG・JPEG・WebP の画像を選んでください")
    if fmt not in ALLOWED_FORMATS:
        raise BrandingError("logo_invalid", "PNG・JPEG・WebP の画像を選んでください")
    if w < 1 or h < 1 or w > MAX_LOGO_PIXELS or h > MAX_LOGO_PIXELS:
        raise BrandingError("logo_dimensions", f"ロゴの縦横は{MAX_LOGO_PIXELS}ピクセルまでです")
    try:
        with Image.open(io.BytesIO(content)) as img:
            img.seek(0)
            img.load()
            rgba = img.convert("RGBA")
    except (OSError, ValueError, Image.DecompressionBombError):
        raise BrandingError("logo_invalid", "画像を読み取れませんでした")
    rgba.thumbnail((OUTPUT_SIZE, OUTPUT_SIZE))
    clean = Image.new("RGBA", rgba.size)
    clean.paste(rgba)
    out = io.BytesIO()
    clean.save(out, format="PNG", optimize=True)
    data = out.getvalue()
    return data, hashlib.sha256(data).hexdigest()


# ===== ドメイン

def clean_domain(value) -> str:
    if not isinstance(value, str):
        raise BrandingError("invalid_domain", "ドメイン(例: example.co.jp)を入力してください")
    d = value.strip().lower().rstrip(".")
    if d.startswith("http://") or d.startswith("https://") or "/" in d or "@" in d or ":" in d:
        raise BrandingError("invalid_domain", "ドメインだけを入力してください(https:// やパスは付けない)")
    try:
        d = d.encode("idna").decode("ascii")
    except UnicodeError:
        raise BrandingError("invalid_domain", "ドメインの形が正しくありません")
    labels = d.split(".")
    if len(d) > 253 or len(labels) < 2 or not all(_LABEL.match(x) for x in labels) or labels[-1].isdigit():
        raise BrandingError("invalid_domain", "ドメインの形が正しくありません")
    if d in ("localhost",) or labels[-1] in ("local", "localhost", "internal", "test", "invalid", "example"):
        raise BrandingError("invalid_domain", "このドメインは確認できません")
    return d


def new_token() -> str:
    return secrets.token_hex(16)


def txt_name(domain: str) -> str:
    return f"{TXT_PREFIX}.{domain}"


def txt_value(token: str) -> str:
    return f"{TXT_VALUE}{token}"


def _dns_resolve_txt(name: str) -> List[str]:
    import dns.exception
    import dns.resolver

    resolver = dns.resolver.Resolver()
    resolver.lifetime = 5.0
    try:
        answer = resolver.resolve(name, "TXT")
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    except dns.exception.DNSException as e:
        raise LookupError(type(e).__name__)
    out = []
    for r in answer:
        out.append(b"".join(r.strings).decode("utf-8", "replace"))
    return out


# 試験・運用で差し替える(引数は TXT の名前、戻り値は値の一覧。引けない時は LookupError)
resolve_txt: Callable[[str], List[str]] = _dns_resolve_txt


def check_txt(domain: str, token: str) -> Tuple[bool, Optional[str]]:
    try:
        values = resolve_txt(txt_name(domain))
    except LookupError as e:
        return False, f"dns_error:{str(e)[:60]}"
    except Exception as e:  # noqa: BLE001 - 名前解決の部品の想定外の失敗も「確認できない」にする
        return False, f"dns_error:{type(e).__name__}"[:100]
    want = txt_value(token)
    if any(v.strip() == want for v in values):
        return True, None
    return False, "txt_not_found"


# ===== 席

def seat_count(db: Session, org_id) -> int:
    return db.query(OrganizationMember).filter(OrganizationMember.organization_id == org_id).count()


def record_seat(db: Session, org_id, event: str, user_id, actor_id) -> None:
    db.flush()
    db.add(OrganizationSeatEvent(id=uuid.uuid4(), organization_id=org_id, user_id=user_id, event=event,
                                 seats_after=seat_count(db, org_id), actor_user_id=actor_id,
                                 created_at=datetime.now(timezone.utc)))
