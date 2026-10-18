"""[Gate S2] SEC-03 応答のセキュリティヘッダー(backend の全応答)。

API の応答は JSON・ファイルだけで、ブラウザで画面として描くものではない。そのため最も厳しい既定
(何も読み込ませない・埋め込ませない・参照元を送らない)を付ける。エンドポイントが自分で付けたヘッダー
(公開共有の no-referrer、ダウンロードの Content-Disposition など)は上書きしない。
開発用の API 画面(/docs・/redoc)は外部のスクリプトを読むので CSP を付けない(本番では画面自体を出さない)。
"""
from typing import MutableMapping

from app.core.config import settings

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
NO_STORE_PREFIXES = ("/api/v1/auth", "/api/v1/offline-pack", "/api/v1/privacy")

BASE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Permitted-Cross-Domain-Policies": "none",
}


def apply_security_headers(path: str, headers: MutableMapping[str, str]) -> None:
    for name, value in BASE_HEADERS.items():
        if name not in headers:
            headers[name] = value
    if not path.startswith(DOCS_PATHS) and "Content-Security-Policy" not in headers:
        headers["Content-Security-Policy"] = API_CSP
    if path.startswith(NO_STORE_PREFIXES) and "Cache-Control" not in headers:
        headers["Cache-Control"] = "no-store"
    if settings.is_production and "Strict-Transport-Security" not in headers:
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
