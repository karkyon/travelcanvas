"""[Gate S4] F09 要求の本文の大きさの上限(ASGI middleware)。

以前は上限が無く、巨大な本文(JSON・multipart)を最後まで受け取ってから処理していた(ファイルは
受け取った後に大きさを測っていた)。大量の大きな要求で、メモリ・一時ファイル・CPU を使い切らせる攻撃に弱い。

- Content-Length が上限を超えていれば、本文を読まずに 413 を返す。
- Content-Length の無い要求(chunked)は、読みながら数え、超えた時点で打ち切って 413 にする。
- 上限は通常 ``API_MAX_BODY_BYTES``。ファイルを受け取る口(UPLOAD_PATH_SUFFIXES)だけは
  文書の上限 + 余白(``UPLOAD_BODY_OVERHEAD_BYTES``)まで受ける。
"""
from __future__ import annotations

import json
from typing import Callable, Optional

from app.core.config import settings
from app.core.security_headers import apply_security_headers

UPLOAD_PATH_SUFFIXES = ("/documents/upload", "/memories/upload", "/calendar-import/preview")
_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class BodyTooLarge(Exception):
    """本文が上限を超えた(読み途中で打ち切った)。"""


def limit_for_path(path: str) -> int:
    if path.endswith(UPLOAD_PATH_SUFFIXES):
        return max(settings.DOCUMENT_MAX_UPLOAD_SIZE_BYTES, settings.API_MAX_BODY_BYTES) + \
            settings.UPLOAD_BODY_OVERHEAD_BYTES
    return settings.API_MAX_BODY_BYTES


def _content_length(scope) -> Optional[int]:
    for name, value in scope.get("headers") or ():
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return -1
    return None


class BodySizeLimitMiddleware:
    def __init__(self, app: Callable) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        limit = limit_for_path(path)
        declared = _content_length(scope)
        if declared is not None and (declared < 0 or declared > limit):
            await _reject(scope, send, limit)
            return

        received = 0
        exceeded = False
        replaced = False
        started = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body") or b"")
                if received > limit:
                    exceeded = True
                    raise BodyTooLarge()
            return message

        async def guarded_send(message):
            # 読み途中で打ち切った後、アプリが本文の読み取り失敗を 400 等にして返そうとしても、413 に差し替える
            nonlocal started, replaced
            if replaced:
                return
            if exceeded and not started and message.get("type") == "http.response.start":
                replaced = True
                await _reject(scope, send, limit)
                return
            if message.get("type") == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except BodyTooLarge:
            if started or replaced:
                return
            replaced = True
            await _reject(scope, send, limit)


async def _reject(scope, send, limit: int) -> None:
    from app.ops import metrics as ops_metrics

    ops_metrics.registry.count_security_event("body_too_large")
    body = json.dumps(
        {"detail": f"送信されたデータが大きすぎます(上限 {limit // (1024 * 1024)}MB)"}, ensure_ascii=False,
    ).encode("utf-8")
    headers = {"content-type": "application/json", "content-length": str(len(body)), "connection": "close"}
    apply_security_headers(scope.get("path", ""), headers)
    await send({
        "type": "http.response.start",
        "status": 413,
        "headers": [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()],
    })
    await send({"type": "http.response.body", "body": body})
