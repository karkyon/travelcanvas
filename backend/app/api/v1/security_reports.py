"""[Gate S10] SEC-15/18 ブラウザからの CSP 違反の報告(Content-Security-Policy の report-uri / report-to)。

画面の CSP(Gate S2)は、XSS で入り込んだスクリプトの外部読み込み・送信をブラウザに止めさせる。止めた時に
ブラウザが報告を送るようにすると、「誰かが画面にスクリプトを入れようとしている」「拡張機能・改ざんされた
ネットワークが何かを差し込んでいる」「正規の画面が CSP で壊れている」に気付ける。

- 認証は無し(ブラウザが自動で送るため)。だれでも送れるので、報告は「数える」だけにし、点数(Gate S6)には入れない
  (偽の報告で他人を遮断させない)。
- 受け取る形式: ``application/csp-report``(report-uri、旧形式)と ``application/reports+json``(report-to、配列)。
- 本文は 16KB まで。接続元ごとに1分 RATE_LIMIT_CSP_REPORT 件まで(超えたら 429。数えない)。
- 記録は違反した指示(script-src 等)と、止めた読み込み先のオリジン(スキーム+ホスト)だけ。URL のパス・
  クエリ(トークンを含み得る)、画面の URL、スクリプトの断片は残さない。
- /metrics: ``travelcanvas_security_events_total{kind="csp_violation"}``、指示ごとは ``csp_<指示>``(例 ``csp_script_src_elem``)。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response

from app.core.config import settings
from app.ops import metrics as ops_metrics
from app.utils.rate_limiter import check_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/security", tags=["security"])

MAX_REPORT_BYTES = 16 * 1024
MAX_REPORTS_PER_REQUEST = 20
# 数える指示はこの一覧だけ(偽の報告で /metrics の種類を増やされないように)。それ以外は "other"
KNOWN_DIRECTIVES = frozenset({
    "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem",
    "style-src-attr", "img-src", "connect-src", "font-src", "media-src", "frame-src", "child-src", "worker-src",
    "manifest-src", "object-src", "base-uri", "form-action", "frame-ancestors", "require-trusted-types-for",
    "trusted-types",
})
_KNOWN_SPECIAL = {"inline", "eval", "wasm-eval", "self", "data", "blob", "trusted-types-policy", "trusted-types-sink"}


def _directive(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    head = value.strip().split(" ", 1)[0].lower()
    return head if head in KNOWN_DIRECTIVES else "other"


def blocked_origin(value: Any) -> str:
    """止めた読み込み先を、オリジン(またはキーワード)だけにする。パス・クエリ・断片は捨てる。"""
    if not isinstance(value, str) or not value:
        return "unknown"
    v = value.strip().lower()
    if v in _KNOWN_SPECIAL:
        return v
    if v.startswith(("data:", "blob:")):
        return v.split(":", 1)[0]
    try:
        parts = urlsplit(value.strip())
    except ValueError:
        return "invalid"
    if parts.scheme in ("http", "https", "ws", "wss") and parts.hostname:
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{parts.hostname}{port}"[:120]
    if parts.scheme and re.fullmatch(r"[a-z][a-z0-9+.-]{0,20}", parts.scheme):
        return f"{parts.scheme}:"
    return "other"


def parse_reports(content_type: str, payload: Any) -> List[Dict[str, str]]:
    """2つの形式から (指示, 読み込み先のオリジン) を取り出す。形式が違えば空。"""
    out: List[Dict[str, str]] = []
    items: Iterable[Any]
    if isinstance(payload, dict) and isinstance(payload.get("csp-report"), dict):
        body = payload["csp-report"]
        items = [{"directive": body.get("effective-directive") or body.get("violated-directive"),
                  "blocked": body.get("blocked-uri")}]
    elif isinstance(payload, list):
        items = [
            {"directive": (r.get("body") or {}).get("effectiveDirective"),
             "blocked": (r.get("body") or {}).get("blockedURL")}
            for r in payload[:MAX_REPORTS_PER_REQUEST]
            if isinstance(r, dict) and r.get("type") == "csp-violation" and isinstance(r.get("body"), dict)
        ]
    else:
        items = []
    for item in items:
        directive = _directive(item.get("directive"))
        if directive:
            out.append({"directive": directive, "blocked": blocked_origin(item.get("blocked"))})
    return out


@router.post("/csp-report", status_code=204, include_in_schema=False)
async def csp_report(request: Request) -> Response:
    client_ip = request.client.host if request.client else "unknown"
    limit = int(getattr(settings, "RATE_LIMIT_CSP_REPORT", 60))
    if not check_rate_limit(f"csp_report:{client_ip}", limit, 60):
        return Response(status_code=429)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_REPORT_BYTES:
        return Response(status_code=413)
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_REPORT_BYTES:
            return Response(status_code=413)
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, ValueError):
        return Response(status_code=400)
    reports = parse_reports(request.headers.get("content-type", ""), payload)
    if not reports:
        return Response(status_code=400)
    for report in reports:
        ops_metrics.registry.count_security_event("csp_violation")
        ops_metrics.registry.count_security_event("csp_" + report["directive"].replace("-", "_"))
        logger.warning("CSP violation: %s blocked %s", report["directive"], report["blocked"])
    return Response(status_code=204)
