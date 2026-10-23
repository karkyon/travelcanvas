#!/usr/bin/env python3
"""[Gate G3] DEP-04 単体試験(vitest)の標準エラー出力が空であることを確かめる(標準ライブラリだけ)。

    npm test -- --run 2> ../ci-results/vitest-stderr.txt
    python3 ../scripts/ci/check_test_output.py ../ci-results/vitest-stderr.txt

React の act 警告・jsdom の通信の失敗・捕まえていない例外は、試験の setup(src/test/setup.ts)が試験を失敗に
する。ここはその外(試験の外の出力・道具の警告)まで含めて 0 行であることを CI の条件にする。
"""
import sys
from pathlib import Path


def main(argv=None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        sys.stderr.write("使い方: check_test_output.py <stderr のファイル>\n")
        return 2
    p = Path(args[0])
    if not p.is_file():
        sys.stderr.write("[test-output] 標準エラー出力のファイルがありません: %s\n" % p)
        return 1
    lines = [ln for ln in p.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
    if lines:
        sys.stderr.write("[test-output] 単体試験が標準エラーへ %d 行を出しました(0 行であること)。先頭:\n" % len(lines))
        for ln in lines[:40]:
            sys.stderr.write("  " + ln[:300] + "\n")
        return 1
    print("[test-output] 標準エラー出力 0 行")
    return 0


if __name__ == "__main__":
    sys.exit(main())
