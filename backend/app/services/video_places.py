"""[Gate SpotFromMedia] 動画の説明欄(目次)・投稿の文から、場所の名前の候補を拾う(文の規則だけ。外へは送らない)。

例(YouTube の目次):
  1:04 二見興玉神社(伊勢神宮に参拝する前に…)紹介。      → 二見興玉神社
  7:18 おはらい町&おかげ横丁(伊勢うどん「ふくすけ」・赤福本店)紹介。 → おはらい町 / おかげ横丁 / ふくすけ / 赤福本店
  0:23 名古屋からの特急電車料金&まわりゃんせの紹介。     → (場所の名前らしくないので拾わない)

場所の名前らしさ: 「」で囲まれた名前、または末尾が神社・寺・城・横丁・町・参道・カフェ・本店などの語で終わる。
拾った名前は「どの行から」(時刻・その行の文)を添えて返す。住所・位置はここでは調べない(選んだ物だけ後で調べる)。
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional

MAX_ITEMS = 30

_TIME = re.compile(r"^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-‐ー:：]?\s*")
_SUFFIX = re.compile(
    r"(神社|神宮|大社|寺|院|城|城跡|宮|外宮|内宮|公園|庭園|横丁|横町|町|通り|参道|商店街|市場|カフェ|珈琲|喫茶|館|園|島|岬|浜|海岸|港|駅|"
    r"山|岳|峠|川|湖|池|滝|橋|温泉|本店|本舗|支店|店|屋|亭|堂|庵|食堂|酒場|ベーカリー|ホテル|旅館|リゾート|テラス|タワー|"
    r"ビーチ|水族館|動物園|美術館|博物館|記念館|資料館|展望台|灯台|遊園地|パーク|ガーデン|ミュージアム|マーケット|ストリート)$")
# 場所ではない言葉(行・名前ごと捨てる)
_SKIP = re.compile(r"(オープニング|エンディング|まとめ|おわりに|はじめに|イントロ|チャンネル|登録|BLOG|ブログ|Twitter|Instagram|"
                   r"TikTok|X\s*\(|お問い合わせ|提供|PR|料金|紹介のみ|目次|BGM|使用機材|撮影|編集)", re.I)
_TAIL = re.compile(r"(の?(周り方|回り方|歩き方|楽しみ方|見どころ|行き方|食べ歩き|散策|観光|参拝|紹介|解説|レビュー|到着|出発|へ|に行く|"
                   r"に到着|で昼食|で夕食|でランチ|でディナー|編|前編|後編|その\d+)[。!！.\s]*)+$")
_QUOTED = re.compile(r"[「『]([^」』]{2,40})[」』]")
_PAREN = re.compile(r"[((]([^))]*)[))]")
_SPLIT = re.compile(r"\s*[&＆・、,/／]\s*|\s+と\s+")
_HASHTAG = re.compile(r"[#＃]([^\s#＃]{2,30})")


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).strip()


def looks_like_place(name: str) -> bool:
    n = name.strip()
    if not (2 <= len(n) <= 40) or _SKIP.search(n) or re.fullmatch(r"[\d\s:.\-]+", n):
        return False
    if re.search(r"(から|まで|ので|ため|について|とは|のこと|ます|でした|です)", n):
        return False
    return bool(_SUFFIX.search(n))


def _clean(name: str) -> str:
    n = _TAIL.sub("", name.strip()).strip(" 。、.!！?？:：-‐ー")
    return re.sub(r"\s+", " ", n)


def from_text(text: str, title: Optional[str] = None) -> List[Dict[str, Any]]:
    """説明欄・投稿の文から場所の名前の候補(重複なし・最大 30)。各要素: name・time・context・quoted"""
    out: List[Dict[str, Any]] = []
    seen: set = set()

    def add(name: str, time: Optional[str], context: str, quoted: bool = False) -> None:
        n = _clean(_norm(name))
        key = re.sub(r"\s", "", n)
        if not n or key in seen or (not quoted and not looks_like_place(n)) or len(out) >= MAX_ITEMS:
            return
        if quoted and (_SKIP.search(n) or len(n) > 40):
            return
        seen.add(key)
        out.append({"name": n, "time": time, "context": context[:120], "quoted": quoted})

    lines = [_norm(x) for x in (text or "").splitlines()]
    chapters = [ln for ln in lines if _TIME.match(ln)]
    body_lines = chapters if len(chapters) >= 2 else [ln for ln in lines if ln and not re.match(r"https?://", ln)]
    for line in body_lines:
        m = _TIME.match(line)
        time = m.group(1) if m else None
        body = line[m.end():] if m else line
        if not body or re.match(r"https?://", body) or (_SKIP.search(body) and not _SUFFIX.search(_clean(body))):
            if not _QUOTED.search(body):
                continue
        # かっこの中(店の名前が多い)は別に拾う
        for inner in _PAREN.findall(body):
            for q in _QUOTED.findall(inner):
                add(q, time, line, quoted=True)
            for part in _SPLIT.split(_QUOTED.sub("", inner)):
                add(part, time, line)
        main = _PAREN.sub("", body)
        for q in _QUOTED.findall(main):
            add(q, time, line, quoted=True)
        main = _QUOTED.sub("", main)
        for part in _SPLIT.split(_clean(main)):
            add(part, time, line)
    for tag in _HASHTAG.findall(" ".join([title or "", text or ""])):
        add(tag, None, f"#{tag}")
    if title:
        for q in _QUOTED.findall(_norm(title)):
            add(q, None, title, quoted=True)
    return out
