#!/usr/bin/env python3
"""[Gate G3] CI-03 mypy の型の誤りを、記録した基準(backend/mypy-baseline.txt)と比べる。

    cd backend && python3 ../scripts/ci/check_mypy_baseline.py            # 基準より増えたら終了コード 1
    cd backend && python3 ../scripts/ci/check_mypy_baseline.py --update   # 減った時に基準を書き直す

誤りは「ファイル: [種類] 文言」で数える(行番号は含めない。前後の行を直しても基準がずれない)。
基準に無い誤りが1件でもあれば失敗。基準より減った時は書き直しを促す(書き直すまでは合格のまま)。
"""
import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

BASELINE = Path("mypy-baseline.txt")
LINE = re.compile(r"^(?P<path>[^:\s]+\.py):\d+(?::\d+)?: error: (?P<msg>.*?)\s+\[(?P<code>[a-z0-9-]+)\]\s*$")


def run_mypy() -> Counter:
    proc = subprocess.run([sys.executable, "-m", "mypy", "app", "--config-file", "mypy.ini", "--no-error-summary",
                           "--hide-error-context", "--no-pretty"],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out = Counter()
    for line in proc.stdout.splitlines():
        m = LINE.match(line.strip())
        if m:
            msg = re.sub(r'"[^"]*\.py"', '"…"', m.group("msg"))
            out["%s: [%s] %s" % (m.group("path"), m.group("code"), msg)] += 1
    # 終了コード 1 は「型の誤りがある」。誤りの行が1つも無いのに 1 なら、mypy が動いていない(入っていない等)
    if proc.returncode not in (0, 1) or (proc.returncode == 1 and not out):
        sys.stderr.write(proc.stdout[-3000:])
        raise SystemExit("[mypy] mypy を実行できませんでした(終了コード %d)" % proc.returncode)
    return out


def read_baseline() -> Counter:
    c = Counter()
    if BASELINE.is_file():
        for line in BASELINE.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            n, _, key = line.partition(" ")
            c[key] += int(n)
    return c


def write_baseline(c: Counter) -> None:
    body = ["# [Gate G3] CI-03 mypy の既存の誤りの基準(件数 ファイル: [種類] 文言)。増やさない・減ったら書き直す",
            "# 書き直し: cd backend && python3 ../scripts/ci/check_mypy_baseline.py --update"]
    body += ["%d %s" % (n, k) for k, n in sorted(c.items())]
    BASELINE.write_text("\n".join(body) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true")
    args = ap.parse_args(argv)
    current = run_mypy()
    if args.update:
        write_baseline(current)
        print("[mypy] 基準を書き直しました: %d 件" % sum(current.values()))
        return 0
    base = read_baseline()
    new = current - base
    fixed = base - current
    print("[mypy] 誤り %d 件(基準 %d 件)" % (sum(current.values()), sum(base.values())))
    if new:
        print("[mypy] 基準に無い型の誤り %d 件:" % sum(new.values()))
        for k, n in sorted(new.items())[:80]:
            print("  +%d %s" % (n, k))
        return 1
    if fixed:
        print("[mypy] 基準より %d 件減りました。基準を書き直してください(--update)" % sum(fixed.values()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
