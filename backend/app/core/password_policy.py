"""[Gate S2] パスワードの規則(セキュリティ監査 F05、整理 SEC-05)。

以前は登録・ゲストの昇格が `password: str` をそのまま hash へ渡しており、空文字や1文字でも登録できた
(変更だけが8文字以上を検査していた)。AI を使った総当たり・パスワードリスト攻撃は、短い・よくある
パスワードから順に試すため、全ての経路で同じ規則を強制する。

方針(NIST SP 800-63B に沿う):
- 長さ: PASSWORD_MIN_LENGTH 文字以上。上限は bcrypt が扱える 72 バイト(UTF-8)まで
  (bcrypt は 72 バイトを超えた部分を黙って捨てるため、長い入力を受けると後半が意味を持たない)。
- 文字の種類の組み合わせ(大文字・記号など)は強制しない。代わりに、よく使われるパスワード・同じ文字の
  繰り返し・連続した文字・メールアドレスや利用者名を含むものを拒否する。
- 前後の空白は拒否する(入力ミスの元になる)。
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from app.core.config import settings

BCRYPT_MAX_BYTES = 72

# よく使われる・漏洩リストの上位に常に入るパスワード(小文字で比較)。網羅ではなく、最低限の歯止め。
COMMON_PASSWORDS = frozenset({
    "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
    "12345678", "123456789", "1234567890", "12345678910", "87654321", "11111111", "00000000", "88888888",
    "qwertyui", "qwerty123", "qwertyuiop", "qwerty12", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "zaq12wsx",
    "abcd1234", "abc12345", "abcdefgh", "a1b2c3d4", "aa123456", "iloveyou", "iloveyou1", "sunshine",
    "princess", "football", "baseball", "superman", "batman123", "welcome1", "welcome123", "letmein1",
    "trustno1", "admin123", "administrator", "changeme", "changeme1", "default1", "secret123", "test1234",
    "testtest", "guest1234", "monkey123", "dragon123", "master123", "shadow123", "starwars", "whatever",
    "computer", "internet", "michael1", "jennifer", "1234qwer", "asdfghjk", "asdf1234", "zxcvbnm1",
    "travelcanvas", "travelcanvas1", "travel123", "traveler", "pokemon1", "naruto123", "doraemon",
})


class PasswordPolicyError(ValueError):
    """規則に合わない。message は画面にそのまま出せる日本語。"""


def _is_sequential(s: str) -> bool:
    if len(s) < 4:
        return False
    diffs = {ord(b) - ord(a) for a, b in zip(s, s[1:])}
    return diffs in ({1}, {-1})


def _identifiers(email: Optional[str], username: Optional[str]) -> List[str]:
    out = []
    if email:
        local = email.split("@", 1)[0].lower()
        if len(local) >= 4:
            out.append(local)
    if username and len(username) >= 4:
        out.append(username.lower())
    return out


def password_problems(password: Optional[str], *, email: Optional[str] = None,
                      username: Optional[str] = None, extra_banned: Iterable[str] = ()) -> List[str]:
    """規則に合わない理由の一覧(空なら合格)。"""
    if not isinstance(password, str) or password == "":
        return ["パスワードを入力してください"]
    problems: List[str] = []
    min_len = max(8, int(getattr(settings, "PASSWORD_MIN_LENGTH", 8) or 8))
    if len(password) < min_len:
        problems.append(f"パスワードは{min_len}文字以上にしてください")
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        problems.append(f"パスワードが長すぎます(UTF-8 で {BCRYPT_MAX_BYTES} バイトまで。日本語は1文字3バイト)")
    if password != password.strip():
        problems.append("パスワードの前後に空白を入れないでください")
    if any(ord(ch) < 0x20 or ord(ch) == 0x7f for ch in password):
        problems.append("パスワードに制御文字は使えません")
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or lowered in {b.lower() for b in extra_banned if b}:
        problems.append("よく使われるパスワードは使えません")
    elif len(set(password)) <= 2:
        problems.append("同じ文字の繰り返しは使えません")
    elif _is_sequential(lowered):
        problems.append("連続した文字(12345678・abcdefgh など)は使えません")
    for ident in _identifiers(email, username):
        if ident in lowered:
            problems.append("メールアドレスや利用者名を含むパスワードは使えません")
            break
    return problems


def validate_password(password: Optional[str], *, email: Optional[str] = None, username: Optional[str] = None,
                      extra_banned: Iterable[str] = ()) -> str:
    problems = password_problems(password, email=email, username=username, extra_banned=extra_banned)
    if problems:
        raise PasswordPolicyError(problems[0])
    return password  # type: ignore[return-value]
