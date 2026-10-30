#!/usr/bin/env python3
"""[Gate OpsSecrets-Clarity] 画面の配布物(frontend/dist)にサーバーの秘密が入っていないかを確かめる(標準ライブラリだけ)。

    python3 scripts/ci/check_bundle_secrets.py --dist frontend/dist

- 落とすもの: OpenAI の鍵(sk-…)・秘密鍵(-----BEGIN … PRIVATE KEY-----)・サービスアカウントの JSON(private_key_id)、
  サーバー用の設定の名前(OPENAI_API_KEY・GOOGLE_PLACES_API_KEY・ENCRYPTION_KEY・JWT_SECRET_KEY・DATABASE_URL)の値の埋め込み
- Google の鍵(AIza…)は、ブラウザ用に HTTP referrer で制限した公開の鍵だけが画面に入ってよい。見つけたら件数を出し、
  --allow-browser-key が無ければ落とす(今のアプリの画面は Google Maps を読み込まないため、入る理由が無い)
- source map(*.map)は配布物に入れない(VITE_SOURCEMAP を本番で true にしない)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PATTERNS = {
    "openai_key": re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----"),
    "service_account": re.compile(r'"private_key_id"\s*:'),
    "server_setting": re.compile(r"(?:OPENAI_API_KEY|GOOGLE_PLACES_API_KEY|ENCRYPTION_KEY|JWT_SECRET_KEY|DATABASE_URL)"
                                 r"[\"']?\s*[:=]\s*[\"'][^\"']{8,}"),
}
GOOGLE_KEY = re.compile(r"AIza[0-9A-Za-z_-]{35}")
TEXT_SUFFIXES = {".js", ".mjs", ".css", ".html", ".json", ".txt", ".svg", ".webmanifest"}


def scan(dist: Path, allow_browser_key: bool) -> list:
    problems = []
    if not dist.is_dir():
        return ["配布物のフォルダが無い: %s" % dist]
    for path in sorted(dist.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(dist)
        if path.suffix == ".map":
            problems.append("%s: source map を配布物に入れない" % rel)
            continue
        if path.suffix not in TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for name, pattern in PATTERNS.items():
            if pattern.search(text):
                problems.append("%s: %s に当たる文字列がある(値は表示しない)" % (rel, name))
        found = len(GOOGLE_KEY.findall(text))
        if found and not allow_browser_key:
            problems.append("%s: Google の鍵の形の文字列が %d 件(ブラウザ用の公開の鍵だけを、制限して入れる)" % (rel, found))
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default="frontend/dist")
    ap.add_argument("--allow-browser-key", action="store_true")
    args = ap.parse_args(argv)
    problems = scan(Path(args.dist), args.allow_browser_key)
    if problems:
        for p in problems:
            print("bundle-secrets: NG " + p)
        return 1
    print("bundle-secrets: OK 秘密の形の文字列なし(%s)" % args.dist)
    return 0


if __name__ == "__main__":
    sys.exit(main())
