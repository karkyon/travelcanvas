"""[Gate G1] SEC-F2 鍵の一覧(用途・切り替え方・切り替えた時の影響)と、用途を越えた使い回しの検出。

人が読む版は docs/ops/KEY-INVENTORY.md。この一覧と文書の鍵の名前が一致することを
tests/test_gate_g1_keys.py が確かめる(鍵を足した時に文書の書き忘れを残さない)。

鍵の値は表示・保存しない。出すのは版の名前(指紋、``app.core.crypto.key_id``)だけ。
"""
from __future__ import annotations

from typing import Dict, List, Optional
from urllib.parse import urlsplit

# purpose は用途の分類、rotation は切り替え方、impact は切り替えた時に起きること
KEYS: List[Dict[str, object]] = [
    {
        "name": "ENCRYPTION_KEY",
        "purpose": "データの暗号化(予約番号・チケット・秘匿制約・位置・文書の中身・TOTP の秘密・Webhook の鍵など全ての *_ciphertext 列と保存ファイル)",
        "kind": "encryption",
        "rotation": "版の切り替え: 今の値を ENCRYPTION_KEYS_PREVIOUS へ移し、新しい値を入れて `tcops.py keys rekey`。全件が新しい鍵になったら前の鍵を外す",
        "impact": "前の鍵を外す前に掛け直しが終わっていないと、その暗号文が読めなくなる",
        "required_in_production": True,
    },
    {
        "name": "ENCRYPTION_KEYS_PREVIOUS",
        "purpose": "前の暗号化の鍵(復号だけ)。鍵の切り替えの途中だけ置く",
        "kind": "encryption",
        "rotation": "掛け直しが終わったら外す(失効)",
        "impact": "外した鍵の暗号文は読めない(`tcops.py keys status` で残りが0件か確かめてから外す)",
        "required_in_production": False,
        "multi": True,
    },
    {
        "name": "MFA_KEY",
        "purpose": "多要素認証(TOTP)の秘密を包む鍵(データの暗号化の鍵とは別。Gate G3 SEC-F6)",
        "kind": "encryption",
        "rotation": "版の切り替え: 今の値を MFA_KEYS_PREVIOUS へ移し、新しい値を入れて `tcops.py keys rekey`。全件が新しい鍵になったら前の鍵を外す",
        "impact": "前の鍵を外す前に掛け直しが終わっていないと、その人は確認コードでログインできない(回復コードか mfa-reset)",
        "required_in_production": True,
    },
    {
        "name": "MFA_KEYS_PREVIOUS",
        "purpose": "前の TOTP の鍵(復号だけ)。鍵の切り替えの途中だけ置く",
        "kind": "encryption",
        "rotation": "掛け直しが終わったら外す(失効)",
        "impact": "外した鍵で包んだ TOTP の秘密は読めない",
        "required_in_production": False,
        "multi": True,
    },
    {
        "name": "LOOKUP_INDEX_KEY",
        "purpose": "暗号化した値の完全一致・末尾の検索の索引(HMAC の盲索引)",
        "kind": "hmac",
        "rotation": "替えたら `python -m app.ops.backfill_lookup_index --all` で索引を作り直す",
        "impact": "作り直すまで予約番号・同行者名の検索で見つからない",
        "required_in_production": True,
    },
    {
        "name": "DOCUMENT_DOWNLOAD_SIGNING_KEY",
        "purpose": "文書の期限付きダウンロード URL の署名",
        "kind": "signing",
        "rotation": "いつでも替えられる",
        "impact": "発行済みの URL(既定2分)が使えなくなる",
        "required_in_production": True,
    },
    {
        "name": "JWT_SECRET_KEY",
        "purpose": "ログインのトークン(アクセス・refresh)の署名",
        "kind": "signing",
        "rotation": "替えると全員のログインが切れる(侵害が疑われる時は Runbook §8)",
        "impact": "全員が再ログイン",
        "required_in_production": True,
    },
    {
        "name": "OFFLINE_PACK_KEY_SECRET",
        "purpose": "オフラインパック(端末内の暗号化保存)の鍵の元",
        "kind": "derivation",
        "rotation": "替えると全員の端末のオフラインデータが読めなくなる(次に通信した時に取り直す)",
        "impact": "端末のオフラインデータの取り直し",
        "required_in_production": True,
        "derived_from_when_unset": "ENCRYPTION_KEY",
    },
    {
        "name": "CHALLENGE_SECRET_KEY",
        "purpose": "計算の確認(proof of work)の問題の署名",
        "kind": "signing",
        "rotation": "いつでも替えられる",
        "impact": "出題中の問題(既定2分)が無効になる",
        "required_in_production": False,
        "derived_from_when_unset": "JWT_SECRET_KEY",
    },
    {
        "name": "METRICS_TOKEN",
        "purpose": "監視の計測値(/metrics)を見る合言葉",
        "kind": "token",
        "rotation": "監視の道具の設定と同時に替える",
        "impact": "替えるまで監視が 401",
        "required_in_production": True,
    },
]

KEY_NAMES = tuple(str(k["name"]) for k in KEYS)


def _values(s) -> Dict[str, List[str]]:
    """名前 → 値(複数の値を持つ鍵は要素ごと)。未設定は含めない。"""
    out: Dict[str, List[str]] = {}
    for entry in KEYS:
        name = str(entry["name"])
        raw = getattr(s, name, None)
        if not raw:
            continue
        if entry.get("multi"):
            vals = [v.strip() for v in str(raw).split(",") if v.strip()]
        else:
            vals = [str(raw)]
        if vals:
            out[name] = vals
    password = _database_password(getattr(s, "DATABASE_URL", None))
    if password:
        out["DATABASE_URL のパスワード"] = [password]
    return out


def _database_password(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        return urlsplit(url).password
    except ValueError:
        return None


def reuse_problems(s) -> List[str]:
    """同じ値を別の用途で使っている組(値は出さない)。

    ENCRYPTION_KEYS_PREVIOUS に今の ENCRYPTION_KEY と同じ値があるのは無害(読み飛ばす)なので除く。"""
    values = _values(s)
    seen: Dict[str, str] = {}
    problems: List[str] = []
    for name, vals in values.items():
        for v in vals:
            other = seen.get(v)
            if other is None:
                seen[v] = name
                continue
            if other == name:
                continue
            if {other, name} in ({"ENCRYPTION_KEY", "ENCRYPTION_KEYS_PREVIOUS"}, {"MFA_KEY", "MFA_KEYS_PREVIOUS"}):
                continue
            problems.append(f"{other} と {name} が同じ値(用途ごとに別の鍵にする)")
    return problems


def report(s) -> Dict[str, object]:
    """鍵ごとの状態(設定の有無・版の名前・導出元)。値は含めない。"""
    from app.core.crypto import key_id

    rows = []
    for entry in KEYS:
        name = str(entry["name"])
        raw = getattr(s, name, None)
        if entry.get("multi"):
            vals = [v.strip() for v in str(raw or "").split(",") if v.strip()]
            rows.append({"name": name, "configured": bool(vals), "key_ids": [key_id(v) for v in vals]})
            continue
        row = {"name": name, "configured": bool(raw), "key_id": key_id(raw) if raw else None}
        if not raw and entry.get("derived_from_when_unset"):
            row["derived_from"] = entry["derived_from_when_unset"]
        rows.append(row)
    return {"keys": rows, "reuse_problems": reuse_problems(s)}
