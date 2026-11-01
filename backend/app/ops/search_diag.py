"""[Gate SearchUAT] 旅行相談の「候補を探す」(OpenStreetMap・Overpass)の失敗の調査(運用の道具)。

    docker compose exec -T backend python -m app.ops.search_diag [--json]

実環境(omega-dev2 の backend コンテナ)から、次を確かめて結果を出す(鍵・利用者の検索語は扱わない):
1. 送り先の名前解決(DNS)
2. アプリと同じ要求(User-Agent つき)で、伊勢の周り 10km の 観光・食べ物・市場 を探す: HTTP の状態・時間・件数・失敗の分類
3. 比較(原因の切り分け): 同じ送り先・同じ本文(伊勢 10km の観光)で、User-Agent だけを変えて順に3回送る
   (アプリの User-Agent → 付けない(以前のアプリと同じ) → アプリの User-Agent)。各回の時刻・HTTP の状態・時間を残す。
   回数制限・混雑の時刻の差も見るため、前後をアプリの User-Agent で挟む。差が出ても、それだけで原因と断定しない
4. 利用の記録(provider_usage_events)の Overpass の結果の内訳(直近 7 日。件数だけ)

外への要求は合計 6 回(無料の公開 server。間を空けて順に送る)。終了の値: 2 の全てが成功(0件を含む)なら 0、それ以外は 1。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import socket
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from urllib.parse import urlsplit

import httpx

ISE = (34.4875, 136.7091)
CATEGORIES = ("sightseeing", "food", "market")


def _url() -> str:
    from app.core.config import settings

    return (getattr(settings, "OVERPASS_URL", "") or "").strip() or "https://overpass-api.de/api/interpreter"


def dns_check(url: str) -> Dict[str, Any]:
    host = urlsplit(url).hostname or ""
    t = time.monotonic()
    try:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        return {"host": host, "ok": True, "addresses": addrs[:4], "ms": round((time.monotonic() - t) * 1000)}
    except OSError as exc:
        return {"host": host, "ok": False, "error": type(exc).__name__, "ms": round((time.monotonic() - t) * 1000)}


async def probe_app(category: str) -> Dict[str, Any]:
    """アプリと同じ関数・同じ要求で探す(失敗は分類して返す)。"""
    from app.services import search_provider as sp

    t = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=sp.OVERPASS_TIMEOUT) as client:
            rows = await sp.search_overpass("", ISE[0], ISE[1], 10.0, client=client, category=category,
                                            raise_errors=True)
        return {"category": category, "ok": True, "count": len(rows), "ms": round((time.monotonic() - t) * 1000)}
    except sp.SearchProviderError as err:
        return {"category": category, "ok": False, "code": err.code, "status": err.status,
                "ms": round((time.monotonic() - t) * 1000)}


async def compare_user_agent(url: str, pause: float = 2.0) -> List[Dict[str, Any]]:
    """同じ送り先・同じ本文で、User-Agent だけを変えて順に送る(アプリ → なし → アプリ)。状態と時間だけを見る。"""
    from app.services import search_provider as sp

    body = sp.build_overpass_query("", ISE[0], ISE[1], 10.0, "sightseeing")
    out: List[Dict[str, Any]] = []
    for label, headers in (("app_user_agent", {**sp.HEADERS, "Accept": "application/json"}),
                           ("no_user_agent", {"Accept": "application/json"}),
                           ("app_user_agent", {**sp.HEADERS, "Accept": "application/json"})):
        if out:
            await asyncio.sleep(pause)
        t = time.monotonic()
        at = datetime.now(timezone.utc).strftime("%H:%M:%S")
        try:
            # 付けない時は httpx の既定(python-httpx/…)になる(以前のアプリと同じ)
            async with httpx.AsyncClient(timeout=sp.OVERPASS_TIMEOUT) as client:
                resp = await client.post(url, data={"data": body}, headers=headers)
            out.append({"request": label, "at": at, "status": resp.status_code,
                        "ms": round((time.monotonic() - t) * 1000)})
        except Exception as exc:  # noqa: BLE001
            out.append({"request": label, "at": at, "status": None, "error": type(exc).__name__,
                        "ms": round((time.monotonic() - t) * 1000)})
    return out


def usage_breakdown(days: int = 7) -> Dict[str, Any]:
    try:
        from sqlalchemy import func

        from app.core.database import SessionLocal
        from app.models.models import ProviderUsageEvent

        since = datetime.now(timezone.utc) - timedelta(days=days)
        with SessionLocal() as db:
            rows = (db.query(ProviderUsageEvent.result_code, func.count())
                    .filter(ProviderUsageEvent.provider == "overpass", ProviderUsageEvent.created_at >= since)
                    .group_by(ProviderUsageEvent.result_code).all())
        return {"days": days, "by_result": {str(code): int(n) for code, n in rows}}
    except Exception as exc:  # noqa: BLE001 - 記録が読めなくても調査は続ける
        return {"days": days, "error": type(exc).__name__}


CODE_LABEL = {
    "blocked": "提供元が要求を受け付けない(403/406 など)", "rate_limited": "回数の制限(429)",
    "timeout": "時間切れ(応答が来ない)", "server_error": "提供元の障害(5xx)", "network": "通信できない(DNS・接続)",
    "unreadable": "応答を読めない(JSON でない)", "provider_timeout": "提供元の処理の時間切れ(504・runtime error)",
}


def conclusion(report: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    app = report["app_requests"]
    pair = report["user_agent_comparison"]
    with_ua = [p.get("status") for p in pair if p["request"] == "app_user_agent"]
    without_ua = [p.get("status") for p in pair if p["request"] == "no_user_agent"]
    if not report["dns"]["ok"]:
        out.append("名前解決に失敗: backend コンテナから送り先の名前を引けません(DNS・ネットワークの設定)")
    if all(p["ok"] for p in app):
        out.append("アプリの要求(User-Agent つき)は全て成功: " + "、".join(f"{p['category']} {p['count']}件" for p in app))
        if all(s == 200 for s in with_ua) and without_ua and all(s in (403, 406) for s in without_ua):
            out.append(f"同じ本文で User-Agent だけを変えると、付けない要求だけが HTTP {without_ua[0]}(前後の付けた要求は 200)。"
                       "以前の失敗(User-Agent なし)と矛盾しない。反映前のログの分類と合わせて原因を判断する")
        elif without_ua and all(s == 200 for s in without_ua):
            out.append("User-Agent なしでも 200: User-Agent は今の失敗の原因ではない可能性が高い(他の原因を調べる)")
    else:
        codes = sorted({p["code"] for p in app if not p["ok"]})
        out.append("アプリの要求が失敗: " + "、".join(CODE_LABEL.get(c, c) for c in codes))
    return out


async def run() -> Dict[str, Any]:
    url = _url()
    report: Dict[str, Any] = {"at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "endpoint": url,
                              "dns": dns_check(url)}
    report["app_requests"] = [await probe_app(c) for c in CATEGORIES]
    report["user_agent_comparison"] = await compare_user_agent(url)
    report["usage_events"] = usage_breakdown()
    report["conclusion"] = conclusion(report)
    return report


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    report = asyncio.run(run())
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        print(f"[search_diag] {report['at']} 送り先 {report['endpoint']}")
        d = report["dns"]
        dns = ("OK " + ",".join(d.get("addresses", []))) if d["ok"] else ("NG " + d.get("error", ""))
        print(f"  DNS {d['host']}: {dns} ({d['ms']}ms)")
        for p in report["app_requests"]:
            print(f"  アプリの要求 伊勢 10km {p['category']}: "
                  + (f"OK {p['count']}件" if p["ok"] else f"NG {p['code']} HTTP {p['status']}") + f" ({p['ms']}ms)")
        for p in report["user_agent_comparison"]:
            print(f"  比較 {p['at']} {p['request']}: HTTP {p.get('status')} {p.get('error', '')} ({p['ms']}ms)")
        print(f"  利用の記録(直近 {report['usage_events']['days']} 日の Overpass): "
              f"{report['usage_events'].get('by_result', report['usage_events'].get('error'))}")
        for line in report["conclusion"]:
            print(f"  → {line}")
    return 0 if all(p["ok"] for p in report["app_requests"]) else 1


if __name__ == "__main__":
    sys.exit(main())
