#!/usr/bin/env python3
"""画面・運用の確認用に 5 つの旅行のダミーデータを登録し、まとめて元に戻すコマンド。

    python scripts/demo_seed.py seed --owner-email you@example.com   # 登録(backend/ で実行)
    python scripts/demo_seed.py status                               # 登録の有無と公開用 URL
    python scripts/demo_seed.py reset                                # 登録したものだけを消す

- 実際の API をプロセス内で呼ぶので、検証・暗号化・通知は本番の経路と同じ。外部の AI や検索は呼ばない。
- 新しく作った行は全部記録し、同行者役の管理用の行(users.preferences)に保存する。reset はこの記録で消す。
- 本番環境では動かない(APP_ENV=production は拒否)。所有者の既存の旅行や設定は変えない。
"""

import argparse
import io
import math
import os
import re
import struct
import sys
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

KEEPER_EMAIL = "tc-demo-keeper@example.com"
MARKER = "tc_demo_seed"
TZ_OFFSET_NOTE = "ダミーデータ(demo_seed.py)。元に戻す: python scripts/demo_seed.py reset"


class SeedError(Exception):
    pass


def _load():
    """DB の接続設定を読むのは実行時だけにする(--help では読まない)。"""
    from fastapi.testclient import TestClient
    from sqlalchemy import event, text
    from sqlalchemy.orm import Session

    from app.core.auth import AuthResult, get_current_user
    from app.core.config import settings
    from app.core.database import Base, SessionLocal
    from app.main import app
    from app.models import models as m
    from app.services.plan_deletion import purge_plan

    return dict(
        TestClient=TestClient,
        event=event,
        text=text,
        Session=Session,
        AuthResult=AuthResult,
        get_current_user=get_current_user,
        settings=settings,
        Base=Base,
        SessionLocal=SessionLocal,
        app=app,
        m=m,
        purge_plan=purge_plan,
    )


def _guard_environment(env: Dict[str, Any]) -> None:
    current = str(getattr(env["settings"], "APP_ENV", "") or "").strip().lower()
    if current in ("production", "prod") and os.environ.get("DEMO_SEED_ALLOW_PROD") != "yes":
        raise SeedError("APP_ENV=production では実行しません。本当に開発用の環境なら DEMO_SEED_ALLOW_PROD=yes を付けます。")


class Recorder:
    """セッションで新しく入った行を table → 主キーの形で覚える。"""

    def __init__(self, env: Dict[str, Any]) -> None:
        self.rows: Dict[str, Set[str]] = {}
        self.env = env
        env["event"].listen(env["Session"], "after_flush", self._after_flush)

    def _after_flush(self, session: Any, _ctx: Any) -> None:
        for obj in session.new:
            table = obj.__table__
            pk = [getattr(obj, c.key if hasattr(c, "key") else c.name) for c in table.primary_key.columns]
            self.rows.setdefault(table.name, set()).add("|".join(str(v) for v in pk))

    def stop(self) -> None:
        self.env["event"].remove(self.env["Session"], "after_flush", self._after_flush)

    def dump(self) -> Dict[str, List[str]]:
        return {k: sorted(v) for k, v in self.rows.items()}


class Api:
    def __init__(self, env: Dict[str, Any]) -> None:
        self.env = env
        self.client = env["TestClient"](env["app"], base_url="http://demo-seed.local")
        self.problems: List[str] = []

    def as_(self, user: Any) -> "Api":
        auth = self.env["AuthResult"](user=user, is_authenticated=True, is_guest=False)
        self.env["app"].dependency_overrides[self.env["get_current_user"]] = lambda: auth
        return self

    def call(
        self,
        method: str,
        path: str,
        soft: bool = False,
        revision: Any = None,
        headers_extra: Optional[Dict[str, str]] = None,
        **kw: Any,
    ) -> Any:
        headers = {"Idempotency-Key": str(uuid.uuid4()), **(headers_extra or {})}
        if revision is not None:
            headers["If-Match"] = str(revision)
        r = self.client.request(method, "/api/v1" + path, headers=headers, **kw)
        if r.status_code == 428 or (
            r.status_code == 400 and "If-Match" in r.text
        ):  # 楽観ロック: 現在の版を読んで付け直す
            current = self.client.get("/api/v1" + path)
            found = current.json().get("revision", 1) if current.status_code == 200 else 1
            headers["If-Match"] = str(found)
            r = self.client.request(method, "/api/v1" + path, headers=headers, **kw)
        stale = re.search(r"現在の(?:リビジョン|revision): (\d+)", r.text) if r.status_code == 409 else None
        if stale:  # 旅行全体の版が進んでいた場合は最新の版で1回だけやり直す
            headers["If-Match"] = stale.group(1)
            r = self.client.request(method, "/api/v1" + path, headers=headers, **kw)
        if r.status_code >= 400:
            msg = f"{method} {path} → {r.status_code} {r.text[:300]}"
            if soft:
                self.problems.append(msg)
                return None
            raise SeedError(msg)
        ctype = r.headers.get("content-type", "")
        return r.json() if "json" in ctype else r.content

    def post(self, path: str, body: Any = None, **kw: Any) -> Any:
        return self.call("POST", path, json=body if body is not None else {}, **kw)

    def put(self, path: str, body: Any, **kw: Any) -> Any:
        return self.call("PUT", path, json=body, **kw)

    def patch(self, path: str, body: Any, **kw: Any) -> Any:
        return self.call("PATCH", path, json=body, **kw)

    def get(self, path: str, **kw: Any) -> Any:
        return self.call("GET", path, **kw)


# ===== ダミーの画像・音声(リポジトリに素材を入れず、その場で描く) =====


def _scene(seed: int, width: int = 1280, height: int = 860) -> bytes:
    from PIL import Image, ImageDraw
    import random

    rnd = random.Random(seed)
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    palette = [
        ((255, 183, 120), (120, 170, 220)),
        ((130, 195, 240), (225, 240, 250)),
        ((250, 140, 110), (70, 60, 120)),
        ((180, 210, 240), (250, 225, 215)),
        ((70, 90, 150), (240, 180, 150)),
    ]
    top, bottom = palette[seed % len(palette)]
    horizon = int(height * rnd.uniform(0.5, 0.68))
    for y in range(horizon):
        t = y / max(horizon, 1)
        draw.line([(0, y), (width, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    sun = (rnd.randint(150, width - 150), rnd.randint(70, horizon - 100))
    draw.ellipse([sun[0] - 55, sun[1] - 55, sun[0] + 55, sun[1] + 55], fill=(255, 240, 200))
    for layer, shade in enumerate(((95, 120, 140), (70, 100, 105))):
        points = [(0, horizon)]
        x = 0
        while x < width:
            x += rnd.randint(70, 190)
            points.append((x, horizon - rnd.randint(20, 130 - layer * 50)))
        points.append((width, horizon))
        draw.polygon(points, fill=shade)
    sea = (35 + seed % 40, 95 + seed % 60, 125 + seed % 50)
    draw.rectangle([0, horizon, width, height], fill=sea)
    for _ in range(90):
        y = rnd.randint(horizon + 4, height - 4)
        x = rnd.randint(0, width - 60)
        draw.line([(x, y), (x + rnd.randint(20, 80), y)], fill=tuple(min(255, c + 45) for c in sea), width=2)
    draw.rectangle([width - 138, height - 50, width - 16, height - 16], fill=(0, 0, 0))
    draw.text((width - 124, height - 40), "DEMO IMAGE", fill=(255, 255, 255))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82)
    return out.getvalue()


def _receipt(title: str, amount: Any) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (480, 640), (252, 252, 248))
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), "RECEIPT (DEMO)", fill=(20, 20, 20))
    draw.text((30, 70), f"TOTAL  {amount}", fill=(20, 20, 20))
    for i in range(12):
        draw.line([(30, 120 + i * 34), (450, 120 + i * 34)], fill=(190, 190, 190))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _audio() -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(3000 * math.sin(i / 8))) for i in range(8000)))
    return out.getvalue()


# ===== 投入 =====


class TripSeeder:
    def __init__(self, env: Dict[str, Any], db: Any, api: Api, users: Dict[str, Any], spec: Dict[str, Any]) -> None:
        self.env, self.db, self.api, self.users, self.spec = env, db, api, users, spec
        self.tz = ZoneInfo(spec["tz"])
        self.events: Dict[str, Dict[str, Any]] = {}
        self.days: List[Dict[str, Any]] = []
        self.res: Dict[str, str] = {}
        self.exp: Dict[str, Dict[str, Any]] = {}
        self.polls: List[Dict[str, Any]] = []
        self.links: Dict[str, str] = {}
        self.base = ""
        self.past = spec["status"] == "completed"
        self.people = ["O"] + [c for c, _r in spec["members"]]

    def uid(self, code: str) -> str:
        return str(self.users[code].id)

    def at(self, value: str) -> str:
        """ "2026-04-03T15:00" を旅行先の時刻で。オフセットつきはそのまま。"""
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=self.tz)
        return dt.isoformat()

    def owner(self) -> Api:
        return self.api.as_(self.users["O"])

    def run(self) -> Tuple[str, Dict[str, str]]:
        self.create_plan()
        self.members()
        self.itinerary()
        self.places()
        self.reservations()
        self.finance()
        self.discussion()
        self.planning_boxes()
        self.preparation()
        self.branches_and_alerts()
        self.documents_and_imports()
        self.memories()
        self.journey()
        self.publish()
        self.finish()
        return self.plan_id, self.links

    def create_plan(self) -> None:
        s = self.spec
        body = dict(
            title=s["title"],
            description=f"{s['description']}\n\n【{TZ_OFFSET_NOTE}】",
            destination=s["destination"],
            start_date=s["start"],
            end_date=s["end"],
            budget=s["budget"],
            preferences={MARKER: s["key"], "party_size": s["party"], "travelers": s["party"]},
        )
        self.plan_id = str(self.owner().post("/travel-plans/", body)["id"])
        self.base = f"/plans/{self.plan_id}"
        self.tbase = f"/travel-plans/{self.plan_id}"

    def members(self) -> None:
        for code, role in self.spec["members"]:
            inv = self.owner().post(
                f"{self.tbase}/collaborators",
                dict(email=self.users[code].email, role=role, message=f"{self.spec['title']} の計画に参加してください"),
            )
            self.api.as_(self.users[code]).post(f"/travel-plans/invitations/{inv['id']}/accept")
        pending = self.spec.get("pending_invite")
        if pending:
            self.owner().post(
                f"{self.tbase}/collaborators",
                dict(email=self.users[pending[0]].email, role=pending[1], message="都合が合えばぜひ"),
            )

    def itinerary(self) -> None:
        api = self.owner()
        s = self.spec
        for sort, d in enumerate(s["days"]):
            day = api.post(
                f"{self.base}/days",
                dict(
                    local_date=d["date"], timezone_id=d.get("tz", s["tz"]), title=d["title"], notes=d["notes"] or None
                ),
            )
            self.days.append(day)
            prev: Optional[Dict[str, Any]] = None
            for e in d["events"]:
                body = dict(
                    day_id=day["id"],
                    title=e["title"],
                    event_type=e["type"],
                    local_start_time=e["time"],
                    local_end_time=None if e["end"] == e["time"] else e["end"],
                    address=e["addr"],
                    latitude=e["lat"],
                    longitude=e["lng"],
                    description=e["desc"],
                    dining=e.get("dining"),  # [Gate DemoDining] 食事の情報(サンプル)
                )
                if e["time"] and e["end"] and e["end"] < e["time"]:
                    body["end_day_offset"] = 1
                ev = api.post(f"{self.base}/events", {k: v for k, v in body.items() if v is not None})
                ev["_spec"] = e
                ev["_date"] = d["date"]
                self.events[e["key"]] = ev
                if e["seg"] and prev:
                    self.segment(prev, ev, e["seg"], d["date"], e["time"], ZoneInfo(d.get("tz", self.spec["tz"])))
                prev = ev
        self.db.expire_all()

    def segment(self, a: Dict[str, Any], b: Dict[str, Any], seg: Tuple, date: str, arrive: str, tz: Any) -> None:
        mode, mins, km, cost, no, platform, transfers = seg
        arr = datetime.fromisoformat(f"{date}T{arrive}").replace(tzinfo=tz) - timedelta(minutes=5)
        dep = arr - timedelta(minutes=mins)
        body = dict(
            from_event_id=a["id"],
            to_event_id=b["id"],
            mode=mode,
            status="confirmed" if no else "planned",
            planned_departure_at=dep.isoformat(),
            planned_arrival_at=arr.isoformat(),
            distance_km=km,
            duration_minutes=mins,
        )
        if cost is not None:
            body.update(cost=cost, currency="VND" if self.spec["tz"] != "Asia/Tokyo" and cost >= 10000 else "JPY")
        if no:
            body["transport_number"] = no
        if platform:
            body["platform"] = platform
        if transfers is not None:
            body["transfer_count"] = transfers
        if mode == "flight":
            body["luggage_note"] = "受託手荷物 20kg まで"
        self.api.as_(self.users["O"]).post(f"{self.base}/segments", body)

    def places(self) -> None:
        """場所の正本(places)と営業時間。検索の提供元を呼ばず、手で登録した場所として作る。"""
        m = self.env["m"]
        first = True
        for e in [x for d in self.spec["days"] for x in d["events"]]:
            if not e["hours"]:
                continue
            opens, closes, closed = e["hours"]
            place = m.Place(
                name=e["title"],
                category=e["type"],
                latitude=e["lat"],
                longitude=e["lng"],
                address=e["addr"],
                created_by=self.users["O"].id,
                closed_days=closed,
                reservation_required=False,
                price_range="1000〜3000円",
                note=f"ダミーの場所情報({self.spec['title']})",
            )
            self.db.add(place)
            self.db.flush()
            for dow in range(7):
                self.db.add(m.OpeningHours(place_id=place.id, day_of_week=dow, open_time=opens, close_time=closes))
            if first:
                self.db.add(
                    m.PlaceEntrance(
                        place_id=place.id,
                        label="正面入口",
                        latitude=e["lat"],
                        longitude=e["lng"],
                        note="段差なし。スロープあり",
                        accessible=True,
                    )
                )
                first = False
            row = self.db.get(m.TravelEvent, uuid.UUID(self.events[e["key"]]["id"]))
            row.place_id = place.id
        self.db.commit()

        api = self.owner()
        first_day, last_day = self.days[0], self.days[-1]
        if len(self.events) > 4:
            keys = list(self.events)
            a, b = self.events[keys[0]], self.events[keys[1]]
            opt = api.post(
                f"{self.base}/route-options",
                dict(
                    from_event_id=a["id"],
                    to_event_id=b["id"],
                    total_duration_minutes=150,
                    total_cost=5000,
                    currency="JPY",
                    total_distance_km=120,
                    walking_minutes=12,
                    transfer_count=1,
                    accessibility_score=0.8,
                    scenic_score=0.6,
                    co2_estimate_kg=4.2,
                    duration_estimate_low_minutes=140,
                    duration_estimate_high_minutes=175,
                ),
                soft=True,
            )
            if opt:
                api.post(
                    f"{self.base}/route-options/{opt['id']}/legs",
                    dict(
                        mode="train",
                        line="本線",
                        operator="ダミー鉄道",
                        from_label="出発駅",
                        to_label="到着駅",
                        distance_km=110,
                        duration_minutes=130,
                    ),
                    soft=True,
                )
                api.post(
                    f"{self.base}/route-options",
                    dict(
                        from_event_id=a["id"],
                        to_event_id=b["id"],
                        total_duration_minutes=200,
                        total_cost=2800,
                        currency="JPY",
                        total_distance_km=135,
                        walking_minutes=6,
                        transfer_count=0,
                        accessibility_score=0.6,
                        scenic_score=0.9,
                        co2_estimate_kg=9.5,
                    ),
                    soft=True,
                )
        api.put(
            f"{self.base}/movement-settings",
            dict(
                settings=dict(
                    pace="relaxed" if self.spec["key"] == "kanazawa" else "normal",
                    break_minutes=20,
                    party=dict(
                        with_children=False, with_seniors=self.spec["key"] == "kanazawa", size=self.spec["party"]
                    ),
                )
            ),
            soft=True,
        )
        _ = (first_day, last_day)

    def reservations(self) -> None:
        for r in self.spec["reservations"]:
            api = self.owner()
            body = dict(
                type=r["type"],
                status=r["status"],
                provider_name=r["provider"],
                guest_count=r.get("guests"),
                holder_name=r.get("holder"),
                start_at=self.at(r["start"]),
                end_at=self.at(r["end"]),
                timezone_id=self.spec["tz"],
                total_amount=r.get("amount"),
                currency=r.get("cur", "JPY"),
                payment_status=r.get("pay"),
                notes=r.get("notes"),
                confirmation_number=r.get("conf"),
                pin=r.get("pin"),
                contact_phone=r.get("phone"),
                contact_url=r.get("url"),
            )
            if r.get("cancel"):
                body["cancellation_deadline"] = self.at(r["cancel"])
            if r.get("event"):
                body["event_id"] = self.events[r["event"]]["id"]
            created = api.post(f"{self.base}/reservations", {k: v for k, v in body.items() if v is not None})
            rid = created["id"]
            self.res[r["key"]] = rid
            for name, seat, special in r.get("people", []):
                api.post(
                    f"{self.base}/reservations/{rid}/participants",
                    {k: v for k, v in dict(name=name, seat=seat, special_request=special).items() if v},
                )
            if r.get("ticket"):
                ttype, payload, fmt, status = r["ticket"]
                api.post(
                    f"{self.base}/reservations/{rid}/tickets",
                    dict(
                        ticket_type=ttype,
                        payload=payload,
                        barcode_format=fmt,
                        status=status,
                        offline_allowed=True,
                        valid_from=self.at(r["start"]),
                        valid_to=self.at(r["end"]),
                    ),
                )

    def finance(self) -> None:
        f = self.spec["finance"]
        api = self.owner()
        api.put(
            f"{self.base}/finance-settings",
            dict(base_currency=self.spec["currency"], rounding_mode="half_up", remainder_to="payer"),
        )
        fx_ids: Dict[str, Tuple[str, str]] = {}
        for cur, rate, date, source in f.get("fx", []):
            row = api.post(f"{self.base}/fx-rates", dict(currency=cur, rate=float(rate), rate_date=date, source=source))
            fx_ids[cur] = (row["id"], rate)
        for kind, amount, note in f["budgets"]:
            body: Dict[str, Any] = dict(amount=amount, note=note)
            if kind == "total":
                body["kind"] = "total"
            else:
                body.update(kind="category", category=kind)
            api.post(f"{self.base}/budgets", body)
        for date, amount in f["day_budgets"]:
            api.post(f"{self.base}/budgets", dict(kind="day", local_date=date, amount=amount))
        for code, amount in f.get("member_budgets", {}).items():
            self.api.as_(self.users[code]).post(
                f"{self.base}/budgets", dict(kind="member", amount=amount, note="自分の上限")
            )
        api = self.owner()
        for kind, label in f.get("versions", []):
            api.post(f"{self.base}/budget-versions", dict(kind=kind, label=label))
        for row in f["expenses"]:
            title, cat, date, amount, payer, split, res_key, note, tax = row[:9]
            currency = row[9] if len(row) > 9 else self.spec["currency"]
            body = dict(
                title=title,
                category=cat,
                local_date=date,
                amount=amount,
                currency=currency,
                paid_by_user_id=self.uid(payer),
                split_method=split,
                note=note,
            )
            if tax is not None:
                body["tax_amount"] = tax
            if currency != self.spec["currency"]:
                body.update(fx_rate_id=fx_ids[currency][0])
            if split == "none":
                body["participants"] = []
            elif split == "equal":
                body["participants"] = [dict(user_id=self.uid(c)) for c in self.people]
            elif split == "ratio":
                body["participants"] = [dict(user_id=self.uid(c), weight=w) for c, w in f["ratio"][title].items()]
            elif split == "amount":
                body["participants"] = [dict(user_id=self.uid(c), amount=a) for c, a in f["amounts"][title].items()]
            if res_key:
                body.update(related_type="reservation", related_id=self.res[res_key])
            if len(self.exp) < 4:  # 最初の数件には領収書の画像を付ける
                doc = self.owner().call(
                    "POST",
                    f"{self.base}/documents/upload",
                    soft=True,
                    files={"file": (f"receipt_{len(self.exp) + 1}.png", _receipt(title, amount), "image/png")},
                    data={"classification": "internal", "document_type": "receipt"},
                )
                if doc:
                    body["receipt_document_id"] = doc["id"]
            self.exp[title] = self.owner().post(
                f"{self.base}/expenses", {k: v for k, v in body.items() if v is not None}
            )
        api = self.owner()
        if f.get("refund"):
            title, amount, note = f["refund"]
            source = self.exp[title]
            api.post(
                f"{self.base}/expenses",
                dict(
                    title=f"{title} の返金",
                    category=source["category"],
                    local_date=source.get("local_date"),
                    amount=amount,
                    currency=self.spec["currency"],
                    paid_by_user_id=source.get("paid_by_user_id"),
                    split_method="equal",
                    kind="refund",
                    refund_of_expense_id=source["id"],
                    note=note,
                    participants=[dict(user_id=self.uid(c)) for c in self.people],
                ),
                soft=True,
            )
        # 打ち間違えて取り消した支出も1件残す
        wrong = api.post(
            f"{self.base}/expenses",
            dict(
                title="(誤入力)タクシー代の二重登録",
                category="transport",
                local_date=self.spec["start"],
                amount=3400,
                currency=self.spec["currency"],
                paid_by_user_id=self.uid("O"),
                split_method="none",
                participants=[],
            ),
        )
        api.post(f"{self.base}/expenses/{wrong['id']}/void", dict(reason="同じ支出を二重に登録したため"), soft=True)
        for frm, to, amount, on, note in f["settlements"]:
            api.post(
                f"{self.base}/settlements",
                {
                    k: v
                    for k, v in dict(
                        from_user_id=self.uid(frm), to_user_id=self.uid(to), amount=amount, settled_on=on, note=note
                    ).items()
                    if v
                },
            )
        if self.past:
            api.post(f"{self.base}/budget-versions", dict(kind="actual", label="旅行後の実績"), soft=True)
        if f.get("lock"):
            api.post(f"{self.base}/finance-lock", soft=True)

    def _target(self, spec: str) -> Dict[str, Optional[str]]:
        if spec == "plan":
            return dict(target_type="plan")
        if spec == "poll":
            if not self.polls:
                return dict(target_type="plan")
            return dict(target_type="poll", target_id=self.polls[0]["id"])
        kind, key = spec.split(":", 1)
        table = {
            "event": lambda: self.events[key]["id"],
            "reservation": lambda: self.res[key],
            "expense": lambda: self.exp[key]["id"],
        }[kind]
        return dict(target_type=kind, target_id=table())

    def discussion(self) -> None:
        for p in self.spec["polls"]:
            body = dict(
                title=p["title"],
                description=p["desc"],
                options=[dict(label=o) for o in p["options"]],
                is_anonymous=bool(p.get("anonymous")),
                veto_policy="advisory" if p.get("resolve") else "block",
            )
            if p.get("deadline"):
                body["deadline_at"] = self.at(p["deadline"])
            if p.get("quorum"):
                body["quorum"] = p["quorum"]
            poll = self.owner().post(f"{self.base}/polls", body)
            self.polls.append(poll)
            opts = poll["options"]
            for code, values in p["votes"].items():
                votes = []
                for opt, v in zip(opts, values):
                    value, _, reason = v.partition(":")
                    votes.append(
                        {k: x for k, x in dict(option_id=opt["id"], value=value, reason=reason or None).items() if x}
                    )
                self.api.as_(self.users[code]).put(
                    f"{self.base}/polls/{poll['id']}/votes", dict(votes=votes), soft=True
                )
            if p.get("decide") is not None:
                current = self.owner().get(f"{self.base}/polls/{poll['id']}", soft=True) or poll
                if p.get("resolve"):
                    for option in current.get("options", []):
                        for vote in option.get("votes", []) or []:
                            if vote.get("value") in ("veto", "concern") and vote.get("id"):
                                self.owner().post(
                                    f"{self.base}/polls/{poll['id']}/votes/{vote['id']}/resolution",
                                    dict(resolved=True, note="話し合って解決しました"),
                                    soft=True,
                                )
                self.owner().patch(
                    f"{self.base}/polls/{poll['id']}",
                    dict(status="closed", decided_option_id=opts[p["decide"]]["id"]),
                    revision=current.get("revision", poll.get("revision", 1)),
                    soft=True,
                )
        for code, target, text_, status, mentions in self.spec["comments"]:
            body = dict(self._target(target), body=text_, mentions=[self.uid(c) for c in mentions])
            made = self.api.as_(self.users[code]).post(f"{self.base}/comments", body, soft=True)
            if made and status == "resolved":
                self.owner().patch(
                    f"{self.base}/comments/{made['id']}",
                    dict(status="resolved"),
                    revision=made.get("revision", 1),
                    soft=True,
                )

    def planning_boxes(self) -> None:
        api = self.owner()
        made: Dict[str, str] = {}
        for title, note, kind, cat, lat, lng, prio, state in self.spec["candidates"]:
            body = dict(
                title=title,
                note=note,
                category=cat,
                latitude=lat,
                longitude=lng,
                priority=prio,
                address=self.spec["destination"],
            )
            if kind in ("url", "social"):
                body["source_url"] = "https://example.com/demo/" + uuid.uuid4().hex[:8]
            if kind == "social":
                body.update(
                    source_kind="social",
                    platform="instagram",
                    source_url="https://www.instagram.com/p/Demo" + uuid.uuid4().hex[:7] + "/",
                )
            cand = api.post(f"{self.base}/candidates", body)
            made[title] = cand["id"]
            if state == "dismissed":
                api.patch(
                    f"{self.base}/candidates/{cand['id']}",
                    dict(status="dismissed"),
                    revision=cand.get("revision", 1),
                    soft=True,
                )
            elif state.startswith("scheduled:"):
                m = self.env["m"]
                row = self.db.get(m.PlanCandidate, uuid.UUID(cand["id"]))
                row.status = "scheduled"
                row.scheduled_event_id = uuid.UUID(self.events[state.split(":", 1)[1]]["id"])
                self.db.commit()
            elif state == "merge":
                others = [v for k, v in made.items() if k != title]
                if others:
                    api.post(
                        f"{self.base}/candidates/{cand['id']}/merge",
                        dict(into_id=others[0]),
                        revision=cand.get("revision", 1),
                        soft=True,
                    )
        for title, ctype, hard, op, value, weight, scope, privacy in self.spec["constraints"]:
            body = dict(
                title=title,
                constraint_type=ctype,
                hardness=hard,
                operator=op,
                value=dict(value=value),
                privacy_level=privacy,
            )
            if op in ("max", "min"):
                unit = "JPY" if ctype == "budget_limit" else ("km" if value < 10 else "minutes")
                body["value"] = dict(value=value, unit=unit)
            if weight:
                body["weight"] = weight
            if scope.startswith("day:"):
                body.update(scope_type="day", scope_id=self.days[int(scope[4:])]["id"])
            if scope.startswith("event:"):
                body.update(scope_type="event", scope_id=self.events[scope[6:]]["id"])
            api.post(f"{self.base}/constraints", body)

    def preparation(self) -> None:
        api = self.owner()
        for name, cat, qty, req, status, scope in self.spec["packing"]:
            api.post(
                f"{self.base}/packing-items",
                dict(name=name, category=cat, quantity=qty, is_required=req, status=status, scope=scope),
            )
        for title, criteria, due, who, done in self.spec["tasks"]:
            body = dict(title=title, completion_criteria=criteria, due_at=self.at(due), assignee_user_id=self.uid(who))
            task = api.post(f"{self.base}/preparation-tasks", body)
            if done:
                api.patch(
                    f"{self.base}/preparation-tasks/{task['id']}",
                    dict(status="done"),
                    revision=task.get("revision", 1),
                    soft=True,
                )

    def branches_and_alerts(self) -> None:
        api = self.owner()
        for b in self.spec["branches"]:
            assumptions = dict(b["assumptions"])
            if "minutes" in assumptions:
                assumptions.update(day_id=self.days[0]["id"], after="09:00")
            made = api.post(
                f"{self.base}/branches",
                dict(title=b["title"], scenario_type=b["scenario"], assumptions=assumptions),
                soft=True,
            )
            if made and b["status"] == "discarded":
                api.patch(
                    f"{self.base}/branches/{made['id']}",
                    dict(status="discarded"),
                    revision=made.get("revision", 1),
                    soft=True,
                )
        for a in self.spec["alerts"]:
            ev = self.events[a["event"]]
            observed = datetime.fromisoformat(self.at(f"{ev['_date']}T{ev['_spec']['time']}"))
            body = dict(
                kind=a["kind"],
                event_id=ev["id"],
                note=a["note"],
                source="user_report",
                confidence="reported",
                observed_at=min(observed, datetime.now(timezone.utc)).isoformat(),
            )
            if a["kind"] in ("closure", "weather"):
                body["day_id"] = ev["day_id"]
            if a.get("delay"):
                body["delay_minutes"] = a["delay"]
            elif a["kind"] in ("delay", "cancellation"):
                body["delay_minutes"] = 30
            alert = api.post(f"{self.base}/alerts", body, soft=True)
            if not alert:
                continue
            state = a.get("replan")
            replan = api.post(f"{self.base}/alerts/{alert['id']}/replans", soft=True) if state else None
            if replan and state == "applied":
                self._apply_replan(replan)
            if replan and state == "rejected":
                api.post(f"{self.base}/replans/{replan['id']}/reject", revision=replan.get("revision", 1), soft=True)
            if a["status"] != "active":
                api.patch(
                    f"{self.base}/alerts/{alert['id']}",
                    dict(status=a["status"]),
                    revision=alert.get("revision", 1),
                    soft=True,
                )

    def _apply_replan(self, replan: Dict[str, Any]) -> None:
        """A 案で旅程が変わらない時は B 案を試す。"""
        for candidate in ("A", "B"):
            try:
                self.owner().post(
                    f"{self.base}/replans/{replan['id']}/apply",
                    dict(candidate=candidate),
                    revision=replan.get("revision", 1),
                )
                return
            except SeedError as exc:
                last = str(exc)
        self.api.problems.append(last)

    def documents_and_imports(self) -> None:
        api = self.owner()
        for key, rid in list(self.res.items())[:2]:
            doc = self.api.call(
                "POST",
                f"{self.base}/documents/upload",
                soft=True,
                files={"file": (f"{key}_confirmation.png", _receipt(key, "CONFIRMED"), "image/png")},
                data={"classification": "confidential", "document_type": "ticket"},
            )
            if doc:
                api.post(
                    f"{self.base}/documents/{doc['id']}/links",
                    dict(entity_type="reservation", entity_id=rid, relation_type="original"),
                    soft=True,
                )
        for imp in self.spec["imports"]:
            api.post(f"{self.base}/imports/extract/text", dict(text=imp["text"], use_ai=False), soft=True)
        job = api.post(f"{self.base}/imports", dict(consent_given=True), soft=True)
        if job:
            for field, value, conf in (
                ("type", "accommodation", 0.95),
                ("provider_name", self.spec["reservations"][0]["provider"], 0.88),
                ("confirmation_number", "DEMO-REVIEW-0001", 0.72),
            ):
                api.post(
                    f"{self.base}/imports/{job['id']}/candidates",
                    dict(field_path=field, value=value, confidence=conf, evidence_locator="本文 1 行目"),
                    soft=True,
                )
        corr = self.spec.get("correction")
        if corr:
            self.api.as_(self.users["M"]).post(
                f"{self.base}/correction-requests",
                dict(
                    field_label=corr[0],
                    current_value=corr[1],
                    proposed_value=corr[2],
                    source="booking_document",
                    source_note="予約確認メールで確認",
                ),
                soft=True,
            )

    def memories(self) -> None:
        spec = self.spec
        api = self.owner()
        photo_ids: List[str] = []
        for key, caption, seed in spec["photos"]:
            ev = self.events[key]
            e = ev["_spec"]
            occurred = self.at(f"{ev['_date']}T{e['time']}")
            writers = ["O"] + [c for c, r in spec["members"] if r == "editor"]
            who = writers[seed % len(writers)]
            made = self.api.as_(self.users[who]).call(
                "POST",
                f"{self.base}/memories/upload",
                soft=True,
                files={"file": (f"photo_{seed}.jpg", _scene(seed), "image/jpeg")},
                data={
                    k: str(v)
                    for k, v in dict(
                        kind="photo",
                        body=caption,
                        event_id=ev["id"],
                        occurred_at=occurred,
                        place_name=e["title"],
                        latitude=e["lat"],
                        longitude=e["lng"],
                        visibility="members",
                        location_source="exif",
                    ).items()
                    if v is not None
                },
            )
            if made:
                photo_ids.append(made["id"])
                if who == "O":
                    self.owner().post(
                        f"{self.base}/memories/{made['id']}/location",
                        dict(action="confirm", location_visibility="members"),
                        soft=True,
                    )
        api = self.owner()
        for key, text_ in spec["notes"]:
            ev = self.events[key]
            api.post(
                f"{self.base}/memories",
                dict(
                    kind="note",
                    body=text_,
                    event_id=ev["id"],
                    visibility="members",
                    occurred_at=self.at(f"{ev['_date']}T{ev['_spec']['time']}"),
                ),
                soft=True,
            )
        if photo_ids:
            api.put(f"{self.base}/cover", dict(memory_id=photo_ids[0], focus_x=50, focus_y=45, zoom=110), soft=True)
            first_photo = spec["photos"][0][0]
            api.put(
                f"{self.base}/events/{self.events[first_photo]['id']}/image", dict(memory_id=photo_ids[0]), soft=True
            )
        if self.past:
            first = list(self.events.values())[0]
            self.api.call(
                "POST",
                f"{self.base}/memories/upload",
                soft=True,
                files={"file": ("voice.wav", _audio(), "audio/wav")},
                data={"kind": "audio", "body": "出発前の一言", "event_id": first["id"], "visibility": "private"},
            )
            api.post(
                f"{self.base}/memories",
                dict(kind="video", video_url="https://www.youtube.com/watch?v=demo0000000", body="(見本の動画リンク)"),
                soft=True,
            )
            trash = api.post(
                f"{self.base}/memories",
                dict(kind="note", body="消した記録の見本(ごみ箱で確認)", visibility="private"),
                soft=True,
            )
            if trash:
                api.call("DELETE", f"{self.base}/memories/{trash['id']}", soft=True, revision=trash.get("revision", 1))
        if self.spec.get("track") and self.past:
            self.track()

    def track(self) -> None:
        """旅行中の記録の再現。API は「旅行の期間中」かつ本人の同意が必要なので、所有者の同意の設定を変えず直接書く。"""
        from app.core.crypto import encrypt_payload, user_subject
        from app.services import atlas
        from app.services import location_tracks as lt

        m = self.env["m"]
        owner = self.users["O"]
        stops = [
            (datetime.fromisoformat(f"{e['_date']}T{e['_spec']['time']}").replace(tzinfo=self.tz), e["_spec"])
            for e in self.events.values()
            if e["_spec"]["lat"]
        ]
        if len(stops) < 2:
            return
        plan_id = uuid.UUID(self.plan_id)
        track = m.LocationTrack(
            plan_id=plan_id,
            user_id=owner.id,
            mode="synced",
            precision="standard",
            status="stopped",
            stopped_reason="user",
            started_at=stops[0][0],
            stopped_at=stops[-1][0] + timedelta(minutes=30),
            auto_stop_at=stops[-1][0] + timedelta(hours=12),
        )
        self.db.add(track)
        self.db.flush()
        points: List[Dict[str, Any]] = []
        for (t1, a), (t2, b) in zip(stops, stops[1:]):
            for i in range(6):
                ratio = i / 6
                at = t1 + (t2 - t1) * ratio
                points.append(
                    dict(
                        t=at.astimezone(timezone.utc).isoformat(),
                        lat=round(a["lat"] + (b["lat"] - a["lat"]) * ratio, 4),
                        lng=round(a["lng"] + (b["lng"] - a["lng"]) * ratio, 4),
                        acc=18.0,
                    )
                )
        cipher = encrypt_payload(lt.encode(points), user_subject(owner.id))
        self.db.add(
            m.LocationPointBatch(
                track_id=track.id,
                batch_id=uuid.uuid4(),
                points_ciphertext=cipher,
                point_count=len(points),
                first_at=stops[0][0],
                last_at=stops[-1][0],
            )
        )
        track.point_count = len(points)
        cells: Dict[str, Tuple[datetime, datetime]] = {}
        for at, e in stops:
            key = atlas.cell_key(e["lat"], e["lng"], "region")["key"]
            first, _last = cells.get(key, (at, at))
            cells[key] = (first, at)
        for key, (first, last) in cells.items():
            self.db.add(
                m.LocationAreaCell(
                    track_id=track.id,
                    plan_id=plan_id,
                    user_id=owner.id,
                    cell_key=key,
                    first_at=first,
                    last_at=last,
                    dwell_seconds=int((last - first).total_seconds()) + 1800,
                    samples=12,
                )
            )
        self.db.commit()

    def journey(self) -> None:
        if not self.past:
            return
        api = self.owner()
        for ev in self.events.values():
            e = ev["_spec"]
            if not e["actual"]:
                continue
            body: Dict[str, Any] = dict(status=e["actual"], source="manual")
            if e["actual"] == "visited" and e["time"]:
                start = datetime.fromisoformat(f"{ev['_date']}T{e['time']}").replace(tzinfo=self.tz)
                minutes = 5 + (len(e["title"]) % 12)
                body["actual_start_at"] = (start + timedelta(minutes=minutes)).isoformat()
                if e["end"] and e["end"] >= e["time"]:
                    body["actual_end_at"] = (
                        datetime.fromisoformat(f"{ev['_date']}T{e['end']}").replace(tzinfo=self.tz)
                        + timedelta(minutes=minutes)
                    ).isoformat()
            else:
                body["note"] = "時間が足りず立ち寄らなかった"
            api.put(f"{self.base}/journey/events/{ev['id']}", body, soft=True)
        if self.spec.get("visits"):
            api.post(f"{self.base}/visits/assess", soft=True)

    def publish(self) -> None:
        api = self.owner()
        spec = self.spec
        sections = ["cover", "toc", "schedule", "map", "reservations", "packing", "contacts", "costs", "notes"]
        for theme, public in spec["booklets"]:
            exp = api.post(
                f"{self.base}/booklet-exports",
                dict(theme=theme, density="normal", format="web" if public else "print", sections=sections),
                soft=True,
            )
            if exp and public:
                pub = api.post(f"{self.base}/booklet-exports/{exp['export']['id']}/publish", soft=True)
                if pub and pub.get("url"):
                    self.links[f"公開しおり({theme})"] = pub["url"]
        if spec.get("share"):
            permission, passcode = spec["share"]
            body = dict(permission=permission, allow_clone=True)
            if passcode:
                body["passcode"] = passcode
            made = api.post(f"{self.tbase}/share", body, soft=True)
            if made and made.get("url"):
                self.links["共有リンク"] = made["url"] + (f" (合言葉 {passcode})" if passcode else "")
            old = api.post(f"{self.tbase}/share", dict(permission="view"), soft=True)
            if old:
                api.post(f"{self.tbase}/share/{old.get('id')}/revoke", soft=True)
        if spec.get("map_url"):
            api.put(f"{self.base}/external-map", dict(url=spec["map_url"], visibility="members"), soft=True)
        api.put(f"/notifications/settings{self.base}", dict(level="mentions" if self.past else "all"), soft=True)
        if spec.get("upload_link"):
            api.post(f"{self.base}/upload-links", dict(expires_in_days=7), soft=True)
        if spec.get("publish") and spec["photos"]:
            options = dict(location_level="area", include_photos=True)
            from app.api.v1.memory_publish import ACK_MESSAGES

            pub = api.post(
                f"{self.base}/memories/publications", dict(options, acknowledge=list(ACK_MESSAGES)), soft=True
            )
            if pub and pub.get("url"):
                self.links["公開の旅行記"] = pub["url"]
        if spec.get("org"):
            self.org()

    def org(self) -> None:
        api = self.owner()
        org = api.post("/organizations", dict(name="デモ商事 製造部"), soft=True)
        if not org:
            return
        oid = org["id"]
        for code, role in (("S", "member"), ("B", "admin")):
            api.post(f"/organizations/{oid}/members", dict(email=self.users[code].email, role=role), soft=True)
        dist = api.post(
            f"/organizations/{oid}/distributions",
            dict(plan_id=self.plan_id, title="小倉工場 訪問の標準旅程", change_note="初版"),
            soft=True,
        )
        if dist:
            self.api.as_(self.users["S"]).post(
                f"/organizations/{oid}/distributions/{dist['id']}/acknowledge",
                dict(version=dist.get("version", 1)),
                soft=True,
            )

    def small_features(self) -> None:
        """入口が少ない機能: 予定のリンク・出典・臨時休業・QR 投稿・同期の競合・個人の条件の適用。"""
        m = self.env["m"]
        api = self.owner()
        keyed = list(self.events.values())
        for ev in keyed[:3]:
            self.db.add(
                m.EventLink(
                    event_id=uuid.UUID(ev["id"]),
                    link_type="url",
                    label="公式サイト(見本)",
                    url="https://example.com/demo/" + ev["id"][:8],
                )
            )
            self.db.add(
                m.EventLink(event_id=uuid.UUID(ev["id"]), link_type="note", label="メモ", body="集合は10分前。")
            )
        with_place = [e for e in self.spec["days"][0]["events"] if e["hours"]]
        if with_place:
            row = self.db.get(m.TravelEvent, uuid.UUID(self.events[with_place[0]["key"]]["id"]))
            record = m.SourceRecord(
                place_id=row.place_id,
                provider="manual",
                source_url="https://example.com/demo/hours",
                retrieved_at=datetime.now(timezone.utc),
                freshness_state="stale",
            )
            self.db.add(record)
            self.db.flush()
            self.db.add(
                m.FieldSource(
                    place_id=row.place_id,
                    field_name="opening_hours",
                    value=with_place[0]["hours"][0],
                    source_record_id=record.id,
                )
            )
            self.db.add(
                m.PlaceSpecialHours(
                    place_id=row.place_id,
                    local_date=datetime.fromisoformat(self.spec["end"]).date(),
                    kind="closed",
                    note="臨時休業の見本",
                )
            )
        self.db.commit()
        if self.spec["key"] == "kanazawa":
            link = api.post(f"{self.base}/upload-links", dict(expires_in_days=7), soft=True)
            if link:
                session = self.api.call(
                    "POST", f"/public/upload-links/{link['token']}/session", soft=True, json=dict(code=link["code"])
                )
                if session:
                    ev = self.events["kenroku"]
                    self.api.call(
                        "POST",
                        f"/public/upload-links/{link['token']}/upload",
                        soft=True,
                        headers_extra={"X-Upload-Session": session.get("session_token", "")},
                        files={"file": ("qr.jpg", _scene(39), "image/jpeg")},
                        data=dict(
                            body="QR から投稿した1枚",
                            latitude=str(ev["_spec"]["lat"]),
                            longitude=str(ev["_spec"]["lng"]),
                        ),
                    )
            api.put(f"{self.base}/private-profile", dict(applied=True), soft=True)
        if self.spec["key"] == "danang":
            ev = self.events["hlunch"]
            plan = self.db.get(m.TravelPlan, uuid.UUID(self.plan_id))
            self.db.refresh(plan)
            base = plan.revision
            api.put(
                f"{self.base}/events/{ev['id']}",
                dict(description="(サーバー側で更新)Morning Glory は予約を入れた。"),
                revision=base,
                soft=True,
            )
            api.post(
                f"{self.base}/sync",
                dict(
                    device_id="demo-phone",
                    operations=[
                        dict(
                            operation_id=str(uuid.uuid4()),
                            entity_type="event",
                            action="update",
                            entity_id=ev["id"],
                            base_revision=base,
                            fields=dict(description="(スマホで編集)屋台のカオラウに変更したい"),
                        )
                    ],
                ),
                soft=True,
            )

    def finish(self) -> None:
        self.small_features()
        self.owner().post(f"{self.base}/validation-runs", soft=True)  # 全部入れた後の状態で検証する
        self.owner().put(self.tbase, dict(status=self.spec["status"]), soft=True)
        self.backdate()

    def backdate(self) -> None:
        """過去の旅行らしく、作成日時を旅行の前後へ寄せる(順序は保つ)。"""
        if not self.past and self.spec["key"] != "danang":
            return
        text = self.env["text"]
        start = datetime.fromisoformat(self.spec["start"]).replace(tzinfo=self.tz)
        base = start - timedelta(days=40) if self.past else datetime(2026, 9, 10, 21, 0, tzinfo=self.tz)
        span = timedelta(days=38) if self.past else timedelta(days=50)
        tables = [t for t in self.env["Base"].metadata.sorted_tables if "plan_id" in t.c and "created_at" in t.c]
        for t in tables:
            self.db.execute(
                text(f"""UPDATE {t.name} x SET created_at = :base + (:span * (r.rn::float / GREATEST(r.n, 1)))
                FROM (SELECT ctid AS c, row_number() OVER (ORDER BY created_at) AS rn, count(*) OVER () AS n
                      FROM {t.name} WHERE plan_id = :p) r WHERE x.ctid = r.c"""),
                dict(base=base, span=span, p=self.plan_id),
            )
        self.db.execute(text("UPDATE travel_plans SET created_at = :c WHERE id = :p"), dict(c=base, p=self.plan_id))
        self.db.commit()


def _ensure_user(db: Any, m: Any, email: str, username: str, password_hash: Optional[str], active: bool = True) -> Any:
    existing = db.query(m.User).filter(m.User.email == email).first()
    if existing:
        raise SeedError(f"{email} が既にあります。先に reset してください。")
    user = m.User(
        email=email,
        username=username,
        hashed_password=password_hash,
        is_active=active,
        is_verified=True,
        user_type="registered",
        role="user",
    )
    db.add(user)
    db.flush()
    return user


def _keeper(db: Any, m: Any) -> Any:
    return db.query(m.User).filter(m.User.email == KEEPER_EMAIL).first()


def _save(
    db: Any,
    m: Any,
    keeper_id: Any,
    recorder: Recorder,
    owner_id: Any,
    plans: List[str],
    links: Dict[str, Dict[str, str]],
    problems: List[str],
    owner_keys: List[str],
    owner_usage: Dict[str, int],
    complete: bool,
) -> None:
    keeper = db.get(m.User, keeper_id)
    keeper.preferences = {
        MARKER: dict(
            version=1,
            owner_id=str(owner_id),
            plans=plans,
            rows=recorder.dump(),
            links=links,
            problems=problems,
            owner_keys=owner_keys,
            owner_usage=owner_usage,
            complete=complete,
            seeded_at=datetime.now(timezone.utc).isoformat(),
        )
    }
    db.commit()


def cmd_seed(args: argparse.Namespace) -> int:
    env = _load()
    _guard_environment(env)
    from demo_seed_data import COMPANIONS, TRIPS, WISH_PLACES

    m, text = env["m"], env["text"]
    db = env["SessionLocal"]()
    db.expire_on_commit = False
    if _keeper(db, m):
        print("既に登録済みです。やり直すには先に reset を実行してください。", file=sys.stderr)
        return 2
    owner = db.query(m.User).filter(m.User.email == args.owner_email).first()
    if owner is None:
        print(f"{args.owner_email} の利用者が見つかりません。先に登録してください。", file=sys.stderr)
        return 2
    owner_keys = [
        str(r[0])
        for r in db.execute(
            text("SELECT id FROM data_keys WHERE subject_type = 'user' AND subject_id = :u"), dict(u=owner.id)
        ).fetchall()
    ]
    owner_usage = {
        str(r[0]): int(r[1])
        for r in db.execute(
            text("SELECT id, used FROM usage_counters WHERE subject_id = :u"), dict(u=owner.id)
        ).fetchall()
    }
    recorder = Recorder(env)
    plans: List[str] = []
    links: Dict[str, Dict[str, str]] = {}
    api = Api(env)
    password_hash = None
    if args.companion_password:
        from app.core.auth import hash_password

        password_hash = hash_password(args.companion_password)
    keeper = _ensure_user(db, m, KEEPER_EMAIL, "tc-demo-keeper", None, active=False)
    keeper_id = keeper.id
    db.commit()
    code = 0
    try:
        users = {"O": owner}
        for key, (email, name) in COMPANIONS.items():
            users[key] = _ensure_user(db, m, email, name, password_hash)
        db.commit()
        _private_profile(api, owner)
        for spec in TRIPS:
            seeder = TripSeeder(env, db, api, users, spec)
            plan_id, trip_links = seeder.run()
            plans.append(plan_id)
            links[spec["title"]] = trip_links
            _save(db, m, keeper_id, recorder, owner.id, plans, links, api.problems, owner_keys, owner_usage, False)
            print(f"登録: {spec['title']}")
        _extras(env, api, db, owner, users, WISH_PLACES)
        _save(db, m, keeper_id, recorder, owner.id, plans, links, api.problems, owner_keys, owner_usage, True)
    except Exception as exc:  # 途中で止まっても reset できるように記録を残す
        db.rollback()
        for spec_plan in db.query(m.TravelPlan).filter(m.TravelPlan.preferences.isnot(None)).all():
            if (
                isinstance(spec_plan.preferences, dict)
                and MARKER in spec_plan.preferences
                and str(spec_plan.id) not in plans
            ):
                if str(spec_plan.user_id) == str(owner.id):
                    plans.append(str(spec_plan.id))
        _save(db, m, keeper_id, recorder, owner.id, plans, links, api.problems, owner_keys, owner_usage, False)
        if os.environ.get("DEMO_SEED_DEBUG"):
            import traceback

            traceback.print_exc()
        print(f"途中で止まりました: {exc}\n元に戻すには reset を実行してください。", file=sys.stderr)
        code = 1
    finally:
        env["app"].dependency_overrides.pop(env["get_current_user"], None)
        recorder.stop()
    if code == 0:
        _print_status(db, m)
    db.close()
    return code


def _private_profile(api: Api, owner: Any) -> None:
    """個人の非公開の条件。既に登録がある人のものは変えない。"""
    a = api.as_(owner)
    current = a.get("/privacy/private-profile", soft=True)
    if isinstance(current, dict) and not current.get("items"):
        a.put(
            "/privacy/private-profile",
            dict(
                items=[
                    dict(kind="earliest_start", label="朝は8時以降に動きたい", hardness="soft", value="08:00"),
                    dict(kind="daily_travel_max", label="1日の移動は4時間まで", hardness="soft", value=4, unit="hours"),
                    dict(kind="avoid_text", label="生牡蠣は避ける", hardness="hard", value="生牡蠣"),
                ]
            ),
            soft=True,
        )


def _extras(env: Dict[str, Any], api: Api, db: Any, owner: Any, users: Dict[str, Any], wish: List[Tuple]) -> None:
    """旅行に属さない機能: 行きたい場所・お気に入り・訪問済み・隠すエリア。"""
    a = api.as_(owner)
    for i, (name, cat, addr, lat, lng, note, *rest) in enumerate(wish):
        body: Dict[str, Any] = dict(
            name=name, category=cat, address=addr, latitude=lat, longitude=lng, description=note, price_range="$$"
        )
        if rest:
            body["dining"] = rest[0]  # [Gate DemoDining] 食事の情報(サンプル)
        spot = a.post("/spots/", body, soft=True)
        if not spot:
            continue
        if i % 2 == 0:
            a.post(f"/spots/{spot['id']}/favorite", dict(personal_note=note, personal_rating=4.5), soft=True)
        else:
            a.post(f"/spots/{spot['id']}/visit", dict(visit_note="昔行った", source="manual"), soft=True)
    existing = a.get("/privacy-zones", soft=True)
    if isinstance(existing, dict) and not existing.get("zones") and not existing.get("items"):
        a.post("/privacy-zones", dict(label="自宅(デモ)", latitude=34.70, longitude=135.50, radius_m=500), soft=True)
    _ = (env, db, users)


def _print_status(db: Any, m: Any) -> None:
    keeper = _keeper(db, m)
    if not keeper:
        print("登録はありません。")
        return
    data = (keeper.preferences or {}).get(MARKER, {})
    rows = data.get("rows", {})
    print(f"登録日時: {data.get('seeded_at')} 完了: {data.get('complete')}")
    print(
        f"旅行 {len(data.get('plans', []))} 件 / 作成した行 {sum(len(v) for v in rows.values())} 行 / テーブル {len(rows)} 種類"
    )
    for title, links in data.get("links", {}).items():
        print(f"- {title}")
        for label, url in links.items():
            print(f"    {label}: {url}")
    problems = data.get("problems", [])
    if problems:
        print(f"\n任意の項目で登録できなかったもの {len(problems)} 件:")
        for p in problems:
            print("  " + p)


def cmd_status(_args: argparse.Namespace) -> int:
    env = _load()
    db = env["SessionLocal"]()
    _print_status(db, env["m"])
    db.close()
    return 0


def _delete_rows(db: Any, env: Dict[str, Any], rows: Dict[str, List[str]], skip: Set[str]) -> Dict[str, int]:
    text = env["text"]
    deleted: Dict[str, int] = {}
    tables = list(reversed(env["Base"].metadata.sorted_tables))
    for table in tables:
        keys = rows.get(table.name)
        if not keys or table.name in skip:
            continue
        pk = list(table.primary_key.columns)
        count = 0
        for key in keys:
            values = key.split("|")
            where = " AND ".join(f"{c.name}::text = :k{i}" for i, c in enumerate(pk))
            res = db.execute(
                text(f"DELETE FROM {table.name} WHERE {where}"), {f"k{i}": v for i, v in enumerate(values)}
            )
            count += res.rowcount or 0
        deleted[table.name] = count
        db.commit()
    return deleted


def cmd_reset(args: argparse.Namespace) -> int:
    env = _load()
    _guard_environment(env)
    from demo_seed_data import COMPANIONS

    m, text = env["m"], env["text"]
    db = env["SessionLocal"]()
    keeper = _keeper(db, m)
    if not keeper:
        print("登録はありません。何もしませんでした。")
        return 0
    data = (keeper.preferences or {}).get(MARKER, {})
    rows: Dict[str, List[str]] = data.get("rows", {})
    plan_ids = list(dict.fromkeys(list(data.get("plans", [])) + list(rows.get("travel_plans", []))))
    if not args.yes:
        answer = input(f"ダミーの旅行 {len(plan_ids)} 件と関連データを消します。よろしいですか? [y/N] ")
        if answer.strip().lower() != "y":
            print("中止しました。")
            return 1
    now = datetime.now(timezone.utc)
    failed = []
    for pid in plan_ids:
        plan = db.get(m.TravelPlan, uuid.UUID(pid))
        if plan is None:
            continue
        plan.deleted_at = plan.deleted_at or now
        plan.deleted_by_user_id = plan.deleted_by_user_id
        plan.purge_after = plan.purge_after or now
        db.commit()
        if not env["purge_plan"](db, plan, None, reason="demo_reset"):
            failed.append(pid)
    if failed:
        print(
            f"旅行 {len(failed)} 件のファイルが消せませんでした。原因を確かめて再実行してください: {failed}",
            file=sys.stderr,
        )
        return 1
    companion_ids = [
        str(r[0]) for r in db.query(m.User.id).filter(m.User.email.in_([v[0] for v in COMPANIONS.values()])).all()
    ]
    keeper_id = str(keeper.id)
    deleted = _delete_rows(db, env, rows, skip={"users"})
    params = dict(plans=[uuid.UUID(p) for p in plan_ids], users=[uuid.UUID(u) for u in companion_ids + [keeper_id]])
    # 暗号鍵: 破棄済みの行が残るので旅行・同行者の分は消す。所有者の鍵は登録前に無かったものだけ消す
    db.execute(text("DELETE FROM data_keys WHERE subject_id = ANY(:plans) OR subject_id = ANY(:users)"), params)
    owner_id = data.get("owner_id")
    if owner_id:
        db.execute(
            text(
                "DELETE FROM data_keys WHERE subject_type = 'user' AND subject_id = :o AND NOT (id::text = ANY(:keep))"
            ),
            dict(o=uuid.UUID(owner_id), keep=data.get("owner_keys", [])),
        )
    db.execute(text("DELETE FROM audit_logs WHERE resource_id = ANY(:plans)"), params)
    # 使用量は登録の前の値へ戻す(記録に無い組織と同行者の行は消す)
    orgs = [uuid.UUID(o) for o in rows.get("organizations", [])]
    db.execute(
        text("DELETE FROM usage_counters WHERE subject_id = ANY(:users) OR subject_id = ANY(:orgs)"),
        dict(params, orgs=orgs),
    )
    if owner_id:
        usage = data.get("owner_usage", {})
        db.execute(
            text("DELETE FROM usage_counters WHERE subject_id = :o AND NOT (id::text = ANY(:keep))"),
            dict(o=uuid.UUID(owner_id), keep=list(usage)),
        )
        for row_id, used in usage.items():
            db.execute(text("UPDATE usage_counters SET used = :n WHERE id = :i"), dict(n=used, i=uuid.UUID(row_id)))
    db.commit()
    _sweep_users(db, env, params["users"])
    for uid in params["users"]:
        db.execute(text("DELETE FROM users WHERE id = :u"), dict(u=uid))
    db.commit()
    print(
        f"元に戻しました。旅行 {len(plan_ids)} 件、同行者 {len(companion_ids)} 人、関連の行 {sum(deleted.values())} 行を削除。"
    )
    db.close()
    return 0


def _sweep_users(db: Any, env: Dict[str, Any], users: List[uuid.UUID]) -> None:
    """同行者役を指している行を片付ける(任意の列は NULL に、必須の列は行を消す)。"""
    text = env["text"]
    for _round in range(3):
        for table in reversed(env["Base"].metadata.sorted_tables):
            for col in table.columns:
                if not any(fk.column.table.name == "users" for fk in col.foreign_keys):
                    continue
                if col.nullable and not col.primary_key:
                    db.execute(
                        text(f"UPDATE {table.name} SET {col.name} = NULL WHERE {col.name} = ANY(:u)"), dict(u=users)
                    )
                else:
                    db.execute(text(f"DELETE FROM {table.name} WHERE {col.name} = ANY(:u)"), dict(u=users))
        db.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="ダミーの旅行データの登録と削除")
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed", help="5 つの旅行を登録する")
    s.add_argument("--owner-email", required=True, help="旅行の所有者になる既存の利用者のメール")
    s.add_argument(
        "--companion-password", help="同行者役でもログインして確かめる場合のパスワード(省略時はログイン不可)"
    )
    s.set_defaults(func=cmd_seed)
    sub.add_parser("status", help="登録の有無と公開用の URL を表示する").set_defaults(func=cmd_status)
    r = sub.add_parser("reset", help="登録したものだけを消して元に戻す")
    r.add_argument("--yes", action="store_true", help="確認せずに実行する")
    r.set_defaults(func=cmd_reset)
    args = parser.parse_args()
    try:
        return args.func(args)
    except SeedError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
