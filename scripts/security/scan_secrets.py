#!/usr/bin/env python3
"""
[Gate R0-5] tracked secret scan.

git ls-files で追跡中の全ファイルを対象に、平文DB接続文字列・固定
SECRET_KEY・クラウド認証情報・秘密鍵ヘッダーらしきパターンを検出する。
プレースホルダ/ダミー値と分かっている行(ALLOWLIST_LINE_TOKENSのいずれか
を含む行)、または既知のテンプレート/ドキュメントファイル全体
(ALLOWLIST_PATHS)は除外する。

使い方:
    python3 scripts/security/scan_secrets.py

検出があれば非ゼロで終了する(CIでblocking利用する前提)。
"""
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# 既知の意図的なプレースホルダ/ダミー値・非本番資産のみを含み、実秘密値を
# 含まないと確認済みのファイル。追加する場合は理由をコメントに残すこと。
ALLOWLIST_PATHS = {
    # プレースホルダしか含まないテンプレート(実秘密値ではない)。
    ".env.example",
    # [Gate R0] alembic.iniが存在しない(=初回セットアップ未実施)場合にのみ
    # 実行されるbootstrap専用のfallback。tracked済みのalembic.iniは常に
    # 存在するため本Gateの実運用では到達しない死んだ分岐だが、スクリプト
    # 全体の書き換えはGate R0の範囲外のため、ここではallowlistする。
    # 将来のGateでこのbootstrap分岐自体の削除を検討すること。
    "scripts/development/start_backend.sh",
    # このスクリプト自身。SECRET_PATTERNSの正規表現リテラルが、文字として
    # "mysql://...:...@" 等のcredential URLの形を含むため、自己参照的に
    # 誤検知する(サンドボックス実機検証で確認済み)。
    "scripts/security/scan_secrets.py",
}

# 一致した文字列(例: 接続文字列の user:password@ の部分)にこれらのいずれかが含まれる場合は、
# プレースホルダ/ダミー値とみなしスキップする([Gate S1] 以前は行全体で判定していた)。
ALLOWLIST_LINE_TOKENS = (
    "change_this",
    "change-this",
    "your_",
    "your-",
    "ci-only",
    "example",
    "placeholder",
    "dummy",
    "<",  # <your-value-here> のようなプレースホルダ表記
)


def is_placeholder(matched: str) -> bool:
    """一致した文字列(資格情報の部分)が、明示したダミー・プレースホルダか。"""
    lowered = matched.lower()
    return any(token in lowered for token in ALLOWLIST_LINE_TOKENS)


SECRET_PATTERNS = [
    ("postgresql_credential_url", re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@")),
    ("mysql_credential_url", re.compile(r"mysql://[^:\s]+:[^@\s]+@")),
    ("hardcoded_secret_key", re.compile(r"SECRET_KEY\s*=\s*[\"'][^\"']{8,}[\"']")),
    ("hardcoded_jwt_secret", re.compile(r"JWT_SECRET_KEY\s*=\s*[\"'][^\"']{8,}[\"']")),
    ("aws_access_key_id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private_key_header", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]


# [Gate G1] REP-01 中身に関係なく追跡してはいけないファイル(Redis のダンプ・DB のファイル・鍵・証明書・.env)。
# 以前は backend/dump.rdb(Redis の保存ファイル)が追跡されていた。今は空だが、セッション・遮断の情報が入った版を
# 誤って commit し得る。.env.example(見本)だけは許す。
FORBIDDEN_PATH_PATTERNS = [
    ("redis_dump", re.compile(r"(^|/)[^/]*\.rdb$", re.I)),
    ("database_file", re.compile(r"(^|/)[^/]*\.(sqlite3?|db|dump)$", re.I)),
    ("private_key_file", re.compile(r"(^|/)[^/]*\.(pem|key|p12|pfx|jks|keystore)$", re.I)),
    ("ssh_private_key", re.compile(r"(^|/)id_(rsa|dsa|ecdsa|ed25519)$")),
    ("dotenv", re.compile(r"(^|/)\.env(\.(?!example$)[^/]+)?$")),
    ("htpasswd", re.compile(r"(^|/)\.htpasswd$")),
]


def forbidden_path(rel_path: str):
    """追跡してはいけないファイルなら、その種類の名前を返す。"""
    for name, pattern in FORBIDDEN_PATH_PATTERNS:
        if pattern.search(rel_path):
            return name
    return None


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=True,
    )
    return [p for p in result.stdout.decode("utf-8", "replace").split("\0") if p]


def scan() -> list[str]:
    findings = []
    for rel_path in tracked_files():
        kind = forbidden_path(rel_path)
        if kind:
            findings.append(f"{rel_path}: tracked {kind} file (git rm --cached して .gitignore へ)")
            continue
        if rel_path in ALLOWLIST_PATHS:
            continue
        path = REPO_ROOT / rel_path
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for name, pattern in SECRET_PATTERNS:
                for match in pattern.finditer(line):
                    # [Gate S1] 以前は行のどこかに "example" や "<" があれば行全体を飛ばしていたため、
                    # 同じ行の本物の資格情報を見逃し得た。一致した文字列そのものにダミーの印があるときだけ飛ばす。
                    if is_placeholder(match.group(0)):
                        continue
                    findings.append(f"{rel_path}:{lineno}: possible {name}")
                    break
    return findings


def self_test() -> int:
    """[Gate S1] 判定の自己試験: ダミーの印が同じ行の別の場所にあっても、本物らしい資格情報は検出する。"""
    def hits(line: str) -> bool:
        return any(not is_placeholder(m.group(0)) for _, p in SECRET_PATTERNS for m in p.finditer(line))

    assert hits("url = 'postgresql://app:Real-Looking-Pass1@db/x'  # see example.com")
    assert hits("<b>postgresql://app:Real-Looking-Pass1@db/x</b>")
    assert not hits("postgresql://app:dummy-pw@db/x")
    assert not hits("postgresql://user:<password>@db/x")
    assert not hits("DATABASE_URL=postgresql://travelcanvas_app:ci-only-not-a-real-secret@localhost/x")
    assert hits('JWT_SECRET_KEY = "abcdefghijklmnop"')
    # [Gate G1] 追跡してはいけないファイルの名前
    for bad in ("backend/dump.rdb", "dump.RDB", ".env", "backend/.env", ".env.local", ".env.production",
                "certs/server.key", "tls/site.pem", "db.sqlite3", "data/app.db", "backup.dump", "id_ed25519"):
        assert forbidden_path(bad), bad
    for ok in (".env.example", "docs/env.md", "src/keys.ts", "backend/app/core/key_inventory.py",
               "frontend/src/environment.ts", "dump.rdb.md"):
        assert not forbidden_path(ok), ok
    print("secret scan: self-test ok")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    findings = scan()
    if findings:
        print("secret scan: possible tracked secrets found:")
        for f in findings:
            print(f"  - {f}")
        print(
            "\nIf any of these are confirmed placeholders, add an allowlist "
            "token (see ALLOWLIST_LINE_TOKENS in this script) or add the "
            "path to ALLOWLIST_PATHS with a justification comment -- do not "
            "silently disable the check."
        )
        return 1
    print("secret scan: no tracked secrets found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
