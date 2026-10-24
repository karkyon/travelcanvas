"""試験の補助: 「金額などの値が出ていない」ことを文字列で確かめる前に、偶然その数字を含みうる ID・時刻を伏せる。

UUID(例 01000036-…)や時刻のマイクロ秒(例 .120000)は乱数・時計で決まり、確かめたい金額("1000"・"20000")を
偶然含むことがある(omega を模した予行で、旅行の ID に "1000" が入り1回だけ落ちた)。
"""
import re

_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?")
_DATETIME_REPR = re.compile(r"datetime\.datetime\([^)]*\)")


def scrub(text: str) -> str:
    """UUID・時刻(ISO 形式と datetime の repr)を伏せた文字列"""
    return _UUID.sub("<id>", _DATETIME_REPR.sub("<time>", _TIME.sub("<time>", text)))
