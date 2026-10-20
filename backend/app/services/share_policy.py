"""[Gate F45] FR-045(CA-003)安全な共有ポリシー: 共有リンクで見せる項目の規則(DB非依存の純粋関数)。

DOC-15 CA-002/CA-003・DOC-02 FR-021/FC-062・DOC-11 の分類(PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED)を
共有リンクにも強制する。

- PUBLIC(常に見せる): 旅行名・目的地・期間・予定名・予定の種類。
- INTERNAL: 所有者が選べる。既定(標準)で見せる。
- CONFIDENTIAL: 所有者が1つずつ選び、さらに「機密の項目を見せることを確認した」(acknowledge_confidential)
  が無いと保存しない。「すべて」の一括操作(preset=all)でも暗黙に含めない。
- RESTRICTED: 予約番号・PIN・チケット/QR・文書・連絡先と予約者名・正確な位置/GPS・支払い/費用。
  指定されても受け付けない(422 field_restricted)。公開投影の出力候補にそもそも含めない。

既存のリンク(policy が NULL)は本Gate以前と同じ表示(=標準)とする。
"""
from typing import Any, Dict, List, Optional

POLICY_VERSION = 1

# key -> (分類, 表示名, 説明)
FIELDS: Dict[str, Dict[str, str]] = {
    "plan_description": {"classification": "internal", "label": "旅行の説明", "description": "旅行プランの説明文"},
    "day_titles": {"classification": "internal", "label": "日程の見出し", "description": "「1日目」「東山散策」などの日ごとの見出し"},
    "event_times": {"classification": "internal", "label": "予定の時刻", "description": "各予定の開始時刻と終日の印"},
    "event_address": {"classification": "confidential", "label": "予定の住所",
                      "description": "予定に登録した住所の文字列(緯度経度・現在地は含めない)"},
    "event_notes": {"classification": "confidential", "label": "予定のメモ",
                    "description": "予定の説明・メモ欄。予約番号や電話番号を書いていないか確認してください"},
    "reservation_summary": {"classification": "confidential", "label": "予約の概要",
                            "description": "予約の種類・施設名・日時・状態(予約番号・PIN・予約者名・連絡先・金額は含めない)"},
}
FIELD_ORDER = ["plan_description", "day_titles", "event_times", "event_address", "event_notes", "reservation_summary"]

RESTRICTED: List[Dict[str, str]] = [
    {"key": "confirmation_numbers", "label": "予約番号・PIN"},
    {"key": "tickets", "label": "チケット・QR・バーコード"},
    {"key": "documents", "label": "旅券・保険・領収書などの文書"},
    {"key": "contacts", "label": "連絡先・予約者名・参加者のメールアドレス"},
    {"key": "exact_location", "label": "正確な位置(緯度経度)・現在地・GPSの軌跡"},
    {"key": "payments", "label": "支払い・費用・予算"},
]
RESTRICTED_KEYS = {r["key"] for r in RESTRICTED}
ALWAYS_SHOWN = ["旅行名", "目的地", "期間", "予定名", "予定の種類"]

INTERNAL_FIELDS = [k for k in FIELD_ORDER if FIELDS[k]["classification"] == "internal"]
CONFIDENTIAL_FIELDS = [k for k in FIELD_ORDER if FIELDS[k]["classification"] == "confidential"]
PRESETS: Dict[str, List[str]] = {
    "minimal": [],
    "standard": list(INTERNAL_FIELDS),
    # 「すべて」でも機密(CONFIDENTIAL)は含めない(CA-003「一括操作でも機密項目を暗黙公開しない」)
    "all": list(INTERNAL_FIELDS),
}
DEFAULT_FIELDS = list(INTERNAL_FIELDS)
MAX_FIELDS_INPUT = 20


class SharePolicyError(ValueError):
    def __init__(self, code: str, message: str, fields: Optional[List[str]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.fields = fields or []

    def detail(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            out["fields"] = self.fields
        return out


def _ordered(keys) -> List[str]:
    s = set(keys)
    return [k for k in FIELD_ORDER if k in s]


def has_policy_input(payload: Dict[str, Any]) -> bool:
    return any(k in payload for k in ("fields", "preset"))


def resolve(payload: Dict[str, Any]) -> Dict[str, Any]:
    """作成・更新・プレビューの入力から保存する policy を作る。入力が無ければ標準。"""
    preset = payload.get("preset")
    if preset is not None and preset not in PRESETS:
        raise SharePolicyError("unknown_preset", "共有する項目のまとめ(preset)は minimal / standard / all のいずれかです")
    raw = payload.get("fields")
    if raw is None:
        fields = list(PRESETS[preset]) if preset else list(DEFAULT_FIELDS)
    else:
        if not isinstance(raw, list) or len(raw) > MAX_FIELDS_INPUT or not all(isinstance(x, str) for x in raw):
            raise SharePolicyError("invalid_fields", "共有する項目(fields)は項目名の配列で指定してください")
        restricted = sorted({x for x in raw if x in RESTRICTED_KEYS})
        if restricted:
            raise SharePolicyError("field_restricted", "予約番号・チケット・文書・連絡先・正確な位置・支払いは共有リンクで見せられません",
                                   restricted)
        unknown = sorted({x for x in raw if x not in FIELDS})
        if unknown:
            raise SharePolicyError("unknown_field", "共有できない項目名が含まれています", unknown)
        fields = _ordered(raw)
    confidential = [k for k in fields if FIELDS[k]["classification"] == "confidential"]
    if confidential and payload.get("acknowledge_confidential") is not True:
        raise SharePolicyError("confidential_needs_ack",
                               "機密の項目を共有するには、URLを知る人なら誰でも見られることを確認してください", confidential)
    return {"version": POLICY_VERSION, "fields": fields, "preset": preset if raw is None else None}


def fields_of(policy: Optional[Dict[str, Any]]) -> List[str]:
    """保存済み policy から有効な項目を取り出す。NULL(本Gate以前のリンク)は標準。未知の項目・RESTRICTEDは捨てる。"""
    if not policy or not isinstance(policy, dict) or not isinstance(policy.get("fields"), list):
        return list(DEFAULT_FIELDS)
    return _ordered(k for k in policy["fields"] if isinstance(k, str) and k in FIELDS)


def catalog() -> Dict[str, Any]:
    return {
        "fields": [{"key": k, **FIELDS[k]} for k in FIELD_ORDER],
        "restricted": [dict(r) for r in RESTRICTED],
        "always": list(ALWAYS_SHOWN),
        "presets": {k: list(v) for k, v in PRESETS.items()},
    }
