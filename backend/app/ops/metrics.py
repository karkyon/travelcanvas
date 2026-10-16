"""[Gate O1] backend のリクエスト計測(監視用)。

- Prometheus のテキスト形式(監視ツールの標準的な形式)で ``GET /metrics`` に出す。
- ラベルには「ルートの型」(例 ``/api/v1/plans/{plan_id}``)だけを使い、実際のURL(旅行IDなど)は
  入れない。どのルートにも当たらなかった要求は ``<unmatched>`` にまとめる(ラベルの種類が
  利用者の入力で増え続けないようにするため)。
- プロセス内の集計なので、backend を再起動すると0に戻る(監視側は減少を再起動として扱う)。
"""
from __future__ import annotations

import ipaddress
import threading
import time
from typing import Dict, Iterable, Optional, Tuple

LATENCY_BUCKETS: Tuple[float, ...] = (0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0)
UNMATCHED_ROUTE = "<unmatched>"
_MAX_ROUTES = 1000  # 念のための上限(ルート定義は約240件)


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def status_class(status_code: int) -> str:
    if 100 <= status_code < 600:
        return "%dxx" % (status_code // 100)
    return "other"


class MetricsRegistry:
    """スレッドセーフな最小限の集計(カウンタとヒストグラム)。"""

    def __init__(self, buckets: Iterable[float] = LATENCY_BUCKETS) -> None:
        self._lock = threading.Lock()
        self._buckets = tuple(sorted(buckets))
        self._requests: Dict[Tuple[str, str, str], int] = {}
        self._latency_counts: Dict[str, list] = {}
        self._latency_sum: Dict[str, float] = {}
        self._latency_total: Dict[str, int] = {}
        self._exceptions = 0
        self._started_at = time.time()

    def reset(self) -> None:
        with self._lock:
            self._requests.clear()
            self._latency_counts.clear()
            self._latency_sum.clear()
            self._latency_total.clear()
            self._exceptions = 0
            self._started_at = time.time()

    def observe(self, method: str, route: str, status_code: int, seconds: float) -> None:
        method = method.upper() if method else "OTHER"
        with self._lock:
            if route not in self._latency_counts and len(self._latency_counts) >= _MAX_ROUTES:
                route = UNMATCHED_ROUTE
            key = (method, route, status_class(status_code))
            self._requests[key] = self._requests.get(key, 0) + 1
            counts = self._latency_counts.get(route)
            if counts is None:
                counts = [0] * len(self._buckets)
                self._latency_counts[route] = counts
            for i, bound in enumerate(self._buckets):
                if seconds <= bound:
                    counts[i] += 1
            self._latency_sum[route] = self._latency_sum.get(route, 0.0) + max(seconds, 0.0)
            self._latency_total[route] = self._latency_total.get(route, 0) + 1

    def count_exception(self) -> None:
        with self._lock:
            self._exceptions += 1

    def render(self, extra_gauges: Optional[Dict[str, float]] = None) -> str:
        with self._lock:
            requests = dict(self._requests)
            counts = {k: list(v) for k, v in self._latency_counts.items()}
            sums = dict(self._latency_sum)
            totals = dict(self._latency_total)
            exceptions = self._exceptions
            started = self._started_at
        lines = [
            "# HELP travelcanvas_http_requests_total HTTP requests by method, route template and status class.",
            "# TYPE travelcanvas_http_requests_total counter",
        ]
        for (method, route, klass), n in sorted(requests.items()):
            lines.append(
                'travelcanvas_http_requests_total{method="%s",route="%s",status="%s"} %d'
                % (_escape(method), _escape(route), klass, n)
            )
        lines += [
            "# HELP travelcanvas_http_request_duration_seconds HTTP request latency by route template.",
            "# TYPE travelcanvas_http_request_duration_seconds histogram",
        ]
        for route in sorted(counts):
            r = _escape(route)
            for bound, c in zip(self._buckets, counts[route]):
                lines.append(
                    'travelcanvas_http_request_duration_seconds_bucket{route="%s",le="%s"} %d' % (r, _fmt(bound), c)
                )
            lines.append(
                'travelcanvas_http_request_duration_seconds_bucket{route="%s",le="+Inf"} %d' % (r, totals[route])
            )
            lines.append('travelcanvas_http_request_duration_seconds_sum{route="%s"} %.6f' % (r, sums[route]))
            lines.append('travelcanvas_http_request_duration_seconds_count{route="%s"} %d' % (r, totals[route]))
        lines += [
            "# HELP travelcanvas_unhandled_exceptions_total Unhandled exceptions caught by the global handler.",
            "# TYPE travelcanvas_unhandled_exceptions_total counter",
            "travelcanvas_unhandled_exceptions_total %d" % exceptions,
            "# HELP travelcanvas_process_start_time_seconds Process start time (unix seconds).",
            "# TYPE travelcanvas_process_start_time_seconds gauge",
            "travelcanvas_process_start_time_seconds %.3f" % started,
        ]
        for name, value in sorted((extra_gauges or {}).items()):
            lines.append("# TYPE %s gauge" % name)
            lines.append("%s %s" % (name, _fmt(float(value))))
        return "\n".join(lines) + "\n"


def _fmt(v: float) -> str:
    return ("%d" % v) if float(v).is_integer() else repr(float(v))


registry = MetricsRegistry()


def route_template(scope: dict) -> str:
    """要求が当たったルートの型。当たらなかったら ``<unmatched>``。"""
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    return UNMATCHED_ROUTE


_PRIVATE_NETS = [
    ipaddress.ip_network(n)
    for n in (
        "127.0.0.0/8",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "::1/128",
        "fc00::/7",
        "fe80::/10",
    )
]


def is_private_address(host: Optional[str]) -> bool:
    if not host:
        return False
    if host == "testclient":  # Starlette の TestClient
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _PRIVATE_NETS)


def metrics_access_allowed(client_host: Optional[str], authorization: Optional[str], token: Optional[str]) -> bool:
    """``/metrics`` を見せてよいか。

    - ``METRICS_TOKEN`` を設定した場合: ``Authorization: Bearer <token>`` が一致した時だけ。
    - 未設定の場合: 同じ機械・LAN(私設アドレス)からの要求だけ。インターネット側には見せない。
    """
    import hmac

    if token:
        if not authorization or not authorization.startswith("Bearer "):
            return False
        return hmac.compare_digest(authorization[len("Bearer ") :].strip(), token)
    return is_private_address(client_host)
