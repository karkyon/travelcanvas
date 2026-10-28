"""[Gate S1] アプリの全ルート(前置き /api/v1 などを含む完全なパス)を列挙する。

FastAPI 0.13x 以降は、include_router で取り込んだルーターを ``app.routes`` に展開せず、まとまり
(``_IncludedRouter``)のまま持つ。また要求の ``scope["route"]`` は、取り込み元のルーター内での
パス(前置きを含まない。例 ``/plans/{plan_id}``)を指す。

``app.routes`` を直接見るコード(/ready の必須ルーター確認、/metrics のルートの型、CORS の試験)は
新しい版で黙って壊れるため、このモジュールを通す。古い版(展開済みの ``app.routes``)でも同じ結果になる。
"""
from __future__ import annotations

from typing import Any, Dict, Iterator, Optional, Set, Tuple

_iter_route_contexts: Optional[Any]
try:  # FastAPI 0.13x 以降
    from fastapi.routing import iter_route_contexts as _iter_route_contexts
except ImportError:  # pragma: no cover - 古い FastAPI(app.routes が展開済み)
    _iter_route_contexts = None

RouteInfo = Tuple[str, Set[str], Any]


def iter_routes(app: Any) -> Iterator[RouteInfo]:
    """(完全なパス, メソッド, 元のルートオブジェクト) を列挙する。"""
    routes = getattr(app, "routes", [])
    if _iter_route_contexts is None:
        for route in routes:
            yield getattr(route, "path", "") or "", set(getattr(route, "methods", None) or ()), route
        return
    for ctx in _iter_route_contexts(routes):
        yield ctx.path or "", set(ctx.methods or ()), ctx.original_route


def route_paths(app: Any) -> list:
    return [path for path, _, _ in iter_routes(app)]


_FULL_PATHS: Dict[int, Dict[int, str]] = {}


def _full_path_map(app: Any, refresh: bool = False) -> Dict[int, str]:
    key = id(app)
    if refresh or key not in _FULL_PATHS:
        _FULL_PATHS[key] = {id(original): path for path, _, original in iter_routes(app) if path}
    return _FULL_PATHS[key]


def full_path_of(app: Any, route: Any) -> Optional[str]:
    """要求が当たったルート(scope["route"])の完全なパス。分からなければ None。"""
    if app is None or route is None:
        return None
    mapping = _full_path_map(app)
    path = mapping.get(id(route))
    if path is None:  # 起動後にルートが足された場合に1回だけ作り直す
        path = _full_path_map(app, refresh=True).get(id(route))
    return path
