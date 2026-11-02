"""[Gate SearchUAT] 旅行相談の「候補を探す」(OpenStreetMap・Overpass)の失敗の調査(運用の道具)。

    docker compose exec -T backend python -m app.ops.search_diag [--probe] [--compare] [--json]

[Gate SearchUAT-S3] 外へ送る回数を、指定した調べ方の分だけにした(以前は配備のたびに 6 回送り、毎回 User-Agent の
無い要求で 406 を受けていた。運営者は 406 を繰り返す接続元を早く遮断する)。鍵・利用者の検索語は扱わない。

- 既定(配備の後の標準): 名前解決(DNS)・server の状態の照会 ``/api/status``(検索ではない軽い要求 1 回)・
  アプリの待機(429/406 の後に送らない時間)・利用の記録(provider_usage_events の Overpass の結果の内訳。件数だけ)
- ``--probe``: アプリと同じ要求で伊勢の周り 10km の 観光・食べ物・市場 を順に探す(最大 3 回。間を空ける)。
  待機中は送らない。429・403/406 を受けたら残りを送らない
- ``--compare``: 同じ送り先・同じ本文で User-Agent の条件だけを変えて順に送る(最大 3 回・各条件 1 回):
  アプリの User-Agent → HTTP クライアントの既定の User-Agent(python-httpx/…)→ User-Agent の header を付けない。
  実際に送った header(名前と User-Agent の値)を記録する(以前は「付けない」と書いていたが、実は httpx の既定の
  User-Agent が付いていた)。429 を受けたら残りを送らない。差が出ても、それだけで原因と断定しない

終了の値: 既定は DNS と状態の照会が成功なら 0。--probe の時は 3 件とも成功(0件を含む)なら 0。それ以外は 1。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import socket
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx

ISE = (34.4875, 136.7091)
CATEGORIES = ("sightseeing", "food", "market")
PROBE_PAUSE = 5.0
COMPARE_PAUSE = 5.0
# 診断の要求の数の上限(試験と Runbook で同じ値)
MAX_REQUESTS = {"default": 1, "probe": 3, "compare": 3}


def _url() -> str:
    from app.services import search_provider as sp

    return sp.overpass_urls()[0]


def status_url(url: str) -> str:
    """``.../api/interpreter`` → ``.../api/status``(Overpass の状態の照会)。"""
    parts = urlsplit(url)
    path = re.sub(r"/interpreter/?$", "/status", parts.path or "/api/interpreter")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def dns_check(url: str) -> Dict[str, Any]:
    host = urlsplit(url).hostname or ""
    t = time.monotonic()
    try:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        return {"host": host, "ok": True, "addresses": addrs[:4], "ms": round((time.monotonic() - t) * 1000)}
    except OSError as exc:
        return {"host": host, "ok": False, "error": type(exc).__name__, "ms": round((time.monotonic() - t) * 1000)}


def parse_status(text: str) -> Dict[str, Any]:
    """``/api/status`` の本文から、回数の制限と空きの枠だけを読む(接続元の IP 等は出さない)。"""
    out: Dict[str, Any] = {}
    m = re.search(r"Rate limit:\s*(\d+)", text)
    if m:
        out["rate_limit"] = int(m.group(1))
    m = re.search(r"(\d+)\s+slots? available now", text)
    out["slots_available_now"] = int(m.group(1)) if m else 0
    waits = [int(x) for x in re.findall(r"in\s+(-?\d+)\s+seconds", text)]
    if waits:
        out["next_slot_seconds"] = max(0, min(waits))
    return out


async def check_status(url: str) -> Dict[str, Any]:
    """server の状態の照会(検索ではない。1 回)。"""
    from app.services import search_provider as sp

    t = time.monotonic()
    target = status_url(url)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            resp = await client.get(target, headers=sp.HEADERS)
        body: Dict[str, Any] = {"url": target, "status": resp.status_code, "ms": round((time.monotonic() - t) * 1000)}
        if resp.status_code == 200:
            body.update(parse_status(resp.text))
        return body
    except Exception as exc:  # noqa: BLE001
        return {"url": target, "status": None, "error": type(exc).__name__, "ms": round((time.monotonic() - t) * 1000)}


def cooldown_state() -> Optional[Dict[str, Any]]:
    try:
        from app.services import search_guard

        return search_guard.cooldown_remaining()
    except Exception:  # noqa: BLE001
        return None


async def probe_app(category: str) -> Dict[str, Any]:
    """アプリと同じ関数・同じ要求で探す(失敗は分類して返す)。"""
    from app.services import search_guard
    from app.services import search_provider as sp

    t = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=sp.OVERPASS_TIMEOUT) as client:
            rows = await sp.search_overpass("", ISE[0], ISE[1], 10.0, client=client, category=category,
                                            raise_errors=True)
        return {"category": category, "ok": True, "count": len(rows), "partial": bool(getattr(rows, "partial", False)),
                "ms": round((time.monotonic() - t) * 1000)}
    except sp.SearchProviderError as err:
        waited = search_guard.note_failure(err.code, err.status, err.retry_after)
        return {"category": category, "ok": False, "code": err.code, "status": err.status,
                "retry_after": waited, "ms": round((time.monotonic() - t) * 1000)}


async def run_probes(pause: float = PROBE_PAUSE) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for category in CATEGORIES:
        wait = cooldown_state()
        if wait is not None:
            out.append({"category": category, "ok": False, "sent": False, "code": wait["code"],
                        "retry_after": wait["retry_after"], "note": "待機中のため送っていない"})
            continue
        if out:
            await asyncio.sleep(pause)
        out.append({**await probe_app(category), "sent": True})
    return out


# User-Agent の条件: アプリ・HTTP クライアントの既定・header なし
UA_CONDITIONS = ("app_user_agent", "client_default_user_agent", "no_user_agent_header")


async def compare_user_agent(url: str, pause: float = COMPARE_PAUSE) -> List[Dict[str, Any]]:
    """同じ送り先・同じ本文で、User-Agent の条件だけを変えて順に送る。実際に送った header を記録する。"""
    from app.services import search_provider as sp

    body = sp.build_overpass_query("", ISE[0], ISE[1], 10.0, "sightseeing")
    out: List[Dict[str, Any]] = []
    for label in UA_CONDITIONS:
        if any(o.get("status") == 429 for o in out):
            out.append({"request": label, "sent": False, "note": "429 の後のため送っていない"})
            continue
        if out:
            await asyncio.sleep(pause)
        wire: Dict[str, Any] = {}

        async def capture(request: httpx.Request) -> None:
            wire["user_agent"] = request.headers.get("user-agent")
            wire["header_names"] = sorted(k.lower() for k in request.headers.keys())

        t = time.monotonic()
        at = datetime.now(timezone.utc).strftime("%H:%M:%S")
        try:
            async with httpx.AsyncClient(timeout=sp.OVERPASS_TIMEOUT, event_hooks={"request": [capture]}) as client:
                headers = {"Accept": "application/json"}
                if label == "app_user_agent":
                    headers["User-Agent"] = sp.USER_AGENT
                request = client.build_request("POST", url, data={"data": body}, headers=headers)
                if label == "no_user_agent_header":
                    del request.headers["User-Agent"]  # HTTP クライアントの既定も外す(header そのものを送らない)
                resp = await client.send(request)
            out.append({"request": label, "sent": True, "at": at, "status": resp.status_code,
                        "ms": round((time.monotonic() - t) * 1000), "wire": wire})
        except Exception as exc:  # noqa: BLE001
            out.append({"request": label, "sent": True, "at": at, "status": None, "error": type(exc).__name__,
                        "ms": round((time.monotonic() - t) * 1000), "wire": wire})
    return out


def usage_breakdown(days: int = 7) -> Dict[str, Any]:
    """[Gate SearchUAT-S3] 時刻の列は occurred_at(以前は無い列 created_at を参照し、必ず AttributeError だった)。"""
    try:
        from sqlalchemy import func

        from app.core.database import SessionLocal
        from app.models.models import ProviderUsageEvent

        since = datetime.now(timezone.utc) - timedelta(days=days)
        with SessionLocal() as db:
            rows = (db.query(ProviderUsageEvent.result_code, func.count())
                    .filter(ProviderUsageEvent.provider == "overpass", ProviderUsageEvent.occurred_at >= since)
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
    if not report["dns"]["ok"]:
        out.append("名前解決に失敗: backend コンテナから送り先の名前を引けません(DNS・ネットワークの設定)")
    st = report.get("server_status") or {}
    if st:
        if st.get("status") == 200:
            slots = st.get("slots_available_now", 0)
            out.append(f"server の状態: 空きの枠 {slots}"
                       + (f"(次の枠まで {st['next_slot_seconds']} 秒)" if not slots and "next_slot_seconds" in st else "")
                       + "。空きが 0 の間の検索は 429 か待ちになる")
        else:
            out.append(f"server の状態を読めません(HTTP {st.get('status')} {st.get('error', '')})".rstrip())
    wait = report.get("cooldown")
    if wait:
        out.append(f"アプリは待機中: {CODE_LABEL.get(wait['code'], wait['code'])} の後 あと {wait['retry_after']} 秒は送らない")
    probes = report.get("app_requests") or []
    sent = [p for p in probes if p.get("sent", True)]
    if probes:
        if sent and all(p["ok"] for p in sent) and len(sent) == len(probes):
            out.append("アプリの要求は全て成功: " + "、".join(f"{p['category']} {p['count']}件" for p in probes))
        else:
            codes = sorted({p["code"] for p in probes if not p["ok"] and p.get("code")})
            out.append("アプリの要求が失敗: " + "、".join(CODE_LABEL.get(c, c) for c in codes))
    pair = report.get("user_agent_comparison") or []
    by = {p["request"]: p.get("status") for p in pair if p.get("sent")}
    if pair:
        out.append("User-Agent の比較(各 1 回): " + "、".join(f"{k} → HTTP {v}" for k, v in by.items())
                   + "。1 回ずつの比較は時刻の差・混雑を含むため、これだけで原因と断定しない")
    return out


async def run(probe: bool = False, compare: bool = False) -> Dict[str, Any]:
    url = _url()
    report: Dict[str, Any] = {"at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "endpoint": url,
                              "mode": "compare" if compare else "probe" if probe else "default",
                              "dns": dns_check(url), "cooldown": cooldown_state()}
    report["server_status"] = await check_status(url)
    if probe:
        report["app_requests"] = await run_probes()
    if compare:
        report["user_agent_comparison"] = await compare_user_agent(url)
    report["usage_events"] = usage_breakdown()
    report["requests_sent"] = (1 + sum(1 for p in report.get("app_requests", []) if p.get("sent"))
                               + sum(1 for p in report.get("user_agent_comparison", []) if p.get("sent")))
    report["conclusion"] = conclusion(report)
    return report


def exit_code(report: Dict[str, Any]) -> int:
    if not report["dns"]["ok"]:
        return 1
    if report.get("app_requests") is not None:
        return 0 if all(p["ok"] for p in report["app_requests"]) else 1
    return 0 if (report.get("server_status") or {}).get("status") == 200 else 1


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--probe", action="store_true", help="アプリと同じ要求で 3 カテゴリを探す(外へ最大 3 回)")
    ap.add_argument("--compare", action="store_true", help="User-Agent の条件の比較(外へ最大 3 回)")
    args = ap.parse_args(argv)
    report = asyncio.run(run(probe=args.probe, compare=args.compare))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
        return exit_code(report)
    print(f"[search_diag] {report['at']} 送り先 {report['endpoint']}(調べ方 {report['mode']}・外への要求 "
          f"{report['requests_sent']} 回)")
    d = report["dns"]
    dns = ("OK " + ",".join(d.get("addresses", []))) if d["ok"] else ("NG " + d.get("error", ""))
    print(f"  DNS {d['host']}: {dns} ({d['ms']}ms)")
    st = report["server_status"]
    print(f"  server の状態 {st['url']}: HTTP {st.get('status')} {st.get('error', '')}"
          f" 空きの枠 {st.get('slots_available_now', '-')} 回数の制限 {st.get('rate_limit', '-')} ({st['ms']}ms)")
    for p in report.get("app_requests", []):
        if not p.get("sent", True):
            print(f"  アプリの要求 伊勢 10km {p['category']}: 送らず({p.get('note')}・あと {p.get('retry_after')} 秒)")
            continue
        print(f"  アプリの要求 伊勢 10km {p['category']}: "
              + (f"OK {p['count']}件{'(一部)' if p.get('partial') else ''}" if p["ok"]
                 else f"NG {p['code']} HTTP {p['status']}") + f" ({p['ms']}ms)")
    for p in report.get("user_agent_comparison", []):
        if not p.get("sent"):
            print(f"  比較 {p['request']}: 送らず({p.get('note')})")
            continue
        w = p.get("wire") or {}
        print(f"  比較 {p['at']} {p['request']}: HTTP {p.get('status')} {p.get('error', '')} ({p['ms']}ms)"
              f" 送った User-Agent={w.get('user_agent')!r}")
    print(f"  利用の記録(直近 {report['usage_events']['days']} 日の Overpass): "
          f"{report['usage_events'].get('by_result', report['usage_events'].get('error'))}")
    for line in report["conclusion"]:
        print(f"  → {line}")
    return exit_code(report)


if __name__ == "__main__":
    sys.exit(main())
