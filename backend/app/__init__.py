"""TravelCanvas backend。

[Gate O2] backend のどのプロセス(uvicorn・試験・完全削除などのバッチ)でも、最初にこのパッケージが
読み込まれた時点でログの個人情報・秘密を伏せる処理を入れる(B-009、app/core/log_safety.py)。
"""
from app.core import log_safety as _log_safety

_log_safety.install()
