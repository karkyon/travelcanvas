"""[Gate G3] UX-04 エラーの応答の決まり(docs/spec/error-catalog.md。一覧は scripts/ci/render_error_catalog.py が作る)。

全ての API のエラーの応答(HTTP 4xx・5xx)は次の形にする(以前の ``detail`` はそのまま。足すだけ):

    {"detail": <文字列 か {"code", "message", ...} か 入力の検証の一覧>,
     "request_id": "<問い合わせ番号>",       # 応答の X-Request-ID と同じ。サーバーのログを探す鍵
     "retry": "later" | "after_reload" | "no",
     "code": "<detail.code があればその値。5xx は internal_error>"}

- ``retry``: later = 時間をおいてもう一度(429・5xx)、after_reload = 画面を読み直してからもう一度(版の競合の 409・412・428)、
  no = 入力や権限を直さない限り同じ結果(その他の 4xx)
- 利用者向けの文は ``detail.message``(または文字列の ``detail``)。例外の文・SQL・秘密の値は入れない(500 は決まった文だけ)
"""
from typing import Any, Dict, Optional

RETRY_LATER = "later"
RETRY_AFTER_RELOAD = "after_reload"
RETRY_NO = "no"

# 409 のうち、読み直せば通る(版の競合・計算の古さ)もの
_RELOAD_SUFFIXES = ("_stale", "_conflict", "_mismatch", "_changed")
_RELOAD_CODES = {"revision_conflict", "revision_mismatch", "stale_version", "deleted_on_server", "proposal_not_found",
                 "candidate_not_found", "edit_conflict", "plan_conflict", "undo_conflict"}

INTERNAL_ERROR_CODE = "internal_error"
INTERNAL_ERROR_MESSAGE = "サーバー内部でエラーが発生しました。しばらくしてから再試行してください。"


def code_of(detail: Any) -> Optional[str]:
    if isinstance(detail, dict):
        code = detail.get("code")
        return code if isinstance(code, str) and code else None
    return None


def retry_for(status: int, code: Optional[str] = None) -> str:
    if status == 429 or status >= 500:
        return RETRY_LATER
    if status in (412, 428):
        return RETRY_AFTER_RELOAD
    if status == 409:
        if code and (code in _RELOAD_CODES or code.endswith(_RELOAD_SUFFIXES)):
            return RETRY_AFTER_RELOAD
        return RETRY_AFTER_RELOAD if code is None else RETRY_NO
    return RETRY_NO


def envelope(detail: Any, status: int, request_id: Optional[str]) -> Dict[str, Any]:
    code = code_of(detail)
    body: Dict[str, Any] = {"detail": detail, "request_id": request_id, "retry": retry_for(status, code)}
    if code:
        body["code"] = code
    return body
