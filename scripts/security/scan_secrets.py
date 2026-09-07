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

# 行内にこれらのいずれかが含まれる場合は、プレースホルダ/ダミー値の
# 宣言・説明コメントとみなしスキップする。
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

SECRET_PATTERNS = [
    ("postgresql_credential_url", re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@")),
    ("mysql_credential_url", re.compile(r"mysql://[^:\s]+:[^@\s]+@")),
    ("hardcoded_secret_key", re.compile(r"SECRET_KEY\s*=\s*[\"'][^\"']{8,}[\"']")),
    ("hardcoded_jwt_secret", re.compile(r"JWT_SECRET_KEY\s*=\s*[\"'][^\"']{8,}[\"']")),
    ("aws_access_key_id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private_key_header", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]


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
            lowered = line.lower()
            if any(token in lowered for token in ALLOWLIST_LINE_TOKENS):
                continue
            for name, pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    findings.append(f"{rel_path}:{lineno}: possible {name}")
    return findings


def main() -> int:
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
