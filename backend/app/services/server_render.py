"""[Gate Remaining-5] FR-035・FR-046 サーバー側の PDF・画像の生成(Pillow だけ。外へは送らない・費用なし)。

- しおりの版(booklet_exports の写し)→ PDF(A4・150dpi の画像のページ。文字の検索はできない)。表紙・旅程・予約の概要・
  持ち物・メモ・控えの案。写しを作った時の隠す項目・機密の扱いは写しのまま(ここで足さない)
- NOW/NEXT のカード(旅の当日)→ PNG(1080×1350。SNS・メッセージへ貼る大きさ)
- 日本語の字体(IPA ゴシック・Noto Sans CJK)が無い環境では FontUnavailable(画面は「この環境では作れません」)。
  本番の image は Dockerfile で fonts-ipafont-gothic を入れる
- 生成は監査に残す(呼んだ側。種類・ページ数・大きさだけ。中身は残さない)
"""
from __future__ import annotations

import io
import os
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
)
A4 = (1240, 1754)  # 150dpi
MARGIN = 90
MAX_PAGES = 60
INK = (24, 32, 48)
MUTED = (90, 100, 120)
ACCENT = (30, 64, 175)
TYPE_LABEL = {"sightseeing": "観光", "meal": "食事", "dining": "食事", "accommodation": "宿", "transport": "移動",
              "activity": "体験", "shopping": "買い物", "other": "予定"}


class FontUnavailable(Exception):
    pass


def find_font() -> Optional[str]:
    env = os.environ.get("TC_RENDER_FONT")
    for path in ((env,) if env else ()) + FONT_CANDIDATES:
        if path and os.path.isfile(path):
            return path
    return None


def _font(size: int) -> Any:
    path = find_font()
    if path is None:
        raise FontUnavailable("日本語の字体がありません")
    return ImageFont.truetype(path, size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: Any, width: int) -> List[str]:
    out: List[str] = []
    for para in str(text or "").splitlines() or [""]:
        line = ""
        for ch in para:
            if draw.textlength(line + ch, font=font) > width and line:
                out.append(line)
                line = ch
            else:
                line += ch
        out.append(line)
    return out


class _Pages:
    def __init__(self, footer: str):
        self.pages: List[Image.Image] = []
        self.footer = footer
        self.f_title = _font(54)
        self.f_h = _font(36)
        self.f_b = _font(28)
        self.f_s = _font(22)
        self._new()

    def _new(self) -> None:
        if len(self.pages) >= MAX_PAGES:
            raise ValueError("too_many_pages")
        self.img = Image.new("RGB", A4, "white")
        self.draw = ImageDraw.Draw(self.img)
        self.y = MARGIN
        self.pages.append(self.img)
        n = len(self.pages)
        self.draw.text((MARGIN, A4[1] - MARGIN + 30), f"{self.footer} ・ {n}", font=_font(20), fill=MUTED)

    def need(self, h: int) -> None:
        if self.y + h > A4[1] - MARGIN:
            self._new()

    def text(self, text: str, font: Any, fill=INK, indent: int = 0, gap: int = 8) -> None:
        width = A4[0] - 2 * MARGIN - indent
        for line in _wrap(self.draw, text, font, width):
            h = int(font.size * 1.35)
            self.need(h)
            self.draw.text((MARGIN + indent, self.y), line, font=font, fill=fill)
            self.y += h
        self.y += gap

    def rule(self) -> None:
        self.need(20)
        self.draw.line((MARGIN, self.y + 6, A4[0] - MARGIN, self.y + 6), fill=(210, 215, 225), width=2)
        self.y += 20

    def pdf(self) -> bytes:
        buf = io.BytesIO()
        first, rest = self.pages[0], self.pages[1:]
        first.save(buf, "PDF", resolution=150.0, save_all=True, append_images=rest)
        return buf.getvalue()


def booklet_pdf(snapshot: Dict[str, Any], title_fallback: str = "旅のしおり") -> Tuple[bytes, int]:
    """しおりの写し → (PDF, ページ数)"""
    cover = snapshot.get("cover") or {}
    title = str(cover.get("title") or title_fallback)
    p = _Pages(f"TravelCanvas ・ {title}")
    p.text(title, p.f_title, fill=ACCENT, gap=12)
    span = " 〜 ".join(x for x in (cover.get("start_date"), cover.get("end_date")) if x)
    days_label = f"{cover['day_count']}日" if cover.get("day_count") else None
    meta = " ・ ".join(x for x in (cover.get("destination"), span, days_label) if x)
    if meta:
        p.text(meta, p.f_b, fill=MUTED)
    if snapshot.get("watermark_text"):
        p.text(str(snapshot["watermark_text"]), p.f_s, fill=(180, 40, 40))
    p.rule()
    sched = snapshot.get("schedule") or {}
    for d in sched.get("days") or []:
        head = str(d.get("date") or "") + (f" {d['title']}" if d.get("title") else "")
        p.need(120)
        p.text(head, p.f_h, fill=ACCENT, gap=6)
        evs = d.get("events") or []
        if not evs:
            p.text("予定はありません", p.f_s, fill=MUTED, indent=20)
        for e in evs:
            time = "終日" if e.get("is_all_day") else (e.get("local_start_time") or "—")
            kind = TYPE_LABEL.get(str(e.get("event_type") or ""), "")
            line = f"{time}  {e.get('title') or ''}" + (f"({kind})" if kind else "")
            p.text(line, p.f_b, indent=20, gap=2)
            sub = " ・ ".join(x for x in (e.get("place_name"), e.get("address")) if x)
            if sub:
                p.text(sub, p.f_s, fill=MUTED, indent=60, gap=2)
            for r in e.get("reservations") or []:
                p.text(f"予約: {r.get('provider_name') or r.get('type')}({r.get('status')})", p.f_s, fill=MUTED,
                       indent=60, gap=2)
            p.y += 6
        p.rule()
    transport = sched.get("transport") or []
    if transport:
        p.text("移動", p.f_h, fill=ACCENT, gap=6)
        for s in transport:
            line = f"{s.get('departure') or '—'} {s.get('from_label') or ''} → {s.get('to_label') or ''}"
            if s.get("duration_minutes"):
                line += f"({s['duration_minutes']}分)"
            p.text(line, p.f_s, indent=20, gap=2)
        p.rule()
    res = snapshot.get("reservations") or []
    if res:
        p.text("予約", p.f_h, fill=ACCENT, gap=6)
        for r in res:
            line = " ・ ".join(str(x) for x in (r.get("provider_name") or r.get("type"), r.get("start"), r.get("status"))
                              if x)
            p.text(line, p.f_s, indent=20, gap=2)
        p.rule()
    packing = snapshot.get("packing") or []
    if packing:
        p.text("持ち物", p.f_h, fill=ACCENT, gap=6)
        p.text("、".join(f"{i.get('name')}" + (f"×{i['quantity']}" if (i.get("quantity") or 1) > 1 else "")
                        for i in packing), p.f_s, indent=20)
        p.rule()
    notes = snapshot.get("notes")
    if isinstance(notes, str):
        notes = [notes]
    if isinstance(notes, list) and notes:
        p.text("メモ", p.f_h, fill=ACCENT, gap=6)
        for n in notes:
            p.text(f"・{n}", p.f_s, indent=20, gap=2)
    data = p.pdf()
    return data, len(p.pages)


def now_next_png(plan_title: str, now: Optional[Dict[str, Any]], nxt: Optional[Dict[str, Any]],
                 local_date: Optional[str]) -> bytes:
    """NOW/NEXT のカード → PNG(1080×1350)。now/nxt: {title, time, place}"""
    w, h = 1080, 1350
    img = Image.new("RGB", (w, h), (246, 248, 252))
    d = ImageDraw.Draw(img)
    f_t, f_l, f_b, f_s = _font(56), _font(40), _font(64), _font(34)
    d.rounded_rectangle((60, 60, w - 60, h - 60), radius=40, fill="white", outline=(220, 226, 236), width=3)
    y = 120
    for line in _wrap(d, plan_title, f_t, w - 240)[:2]:
        d.text((120, y), line, font=f_t, fill=ACCENT)
        y += 76
    if local_date:
        d.text((120, y), local_date, font=f_s, fill=MUTED)
        y += 60
    for label, item, tone in (("いま", now, (22, 101, 52)), ("つぎ", nxt, (30, 64, 175))):
        y += 40
        d.rounded_rectangle((100, y, w - 100, y + 400), radius=28, fill=(248, 250, 255), outline=(225, 230, 240))
        d.text((140, y + 30), label, font=f_l, fill=tone)
        if item:
            yy = y + 100
            for line in _wrap(d, str(item.get("title") or ""), f_b, w - 300)[:2]:
                d.text((140, yy), line, font=f_b, fill=INK)
                yy += 84
            sub = " ・ ".join(str(x) for x in (item.get("time"), item.get("place")) if x)
            if sub:
                d.text((140, yy + 10), _wrap(d, sub, f_s, w - 300)[0], font=f_s, fill=MUTED)
        else:
            d.text((140, y + 110), "予定はありません", font=f_s, fill=MUTED)
        y += 400
    d.text((120, h - 140), "TravelCanvas", font=f_s, fill=MUTED)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
