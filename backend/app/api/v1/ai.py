"""
[Gate #34] 旧ジョブ型最適化API — 完全廃止(410固定応答)

このファイルはGate #23でジョブ型(POST .../optimize -> job_id発行 ->
GET /optimization/{job_id}でポーリング -> POST .../apply)として実装され、
Gate #33で新設された正規化Plan/Day/Event経路
(POST /plans/{plan}/days/{day}/optimization-proposal + apply)と並行稼働
していた。

2026-09-05付監査(TravelCanvas_最新コード_再監査評価_a0475d2)で
P0-02として指摘された通り、この旧経路のapplyは`TravelPlan.itinerary`を
直接上書きしており、Gate #29〜#33で構築したrevision/If-Match/
Idempotency/ChangeSet/Undoの整合性保証を一切通らない。同一データに対して
正本が二重に存在し得る状態(P0-01)を作り出す最大の要因だったため、本Gateで
経路そのものを閉じる。

[廃止方針]
- 以下5エンドポイントは全て410 Goneを返す固定応答へ置き換える。
- 旧`OptimizationResult`テーブルへの新規書き込み・`plan.itinerary`の
  書き換えは一切発生しない(このファイルはもはやDBへ触れない)。
- 呼び出し側(旧frontend OptimizationPage/OptimizationSelectPage)は
  Gate #34で新しい提案ベースのエンドポイント
  (`/plans/{plan_id}/days/{day_id}/optimization-proposal` および
  対応するapply)へ完全移行する。frontend側の除去はGate #34bで行う。
- エラーレスポンスは安定したerror_codeを持ち、detailに内部情報を含めない。
"""
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, status

router = APIRouter(tags=["ai-optimization-legacy-retired"])

_LEGACY_ENDPOINT_RETIRED_DETAIL = (
    "この最適化APIは廃止されました。/plans/{plan_id}/days/{day_id}/"
    "optimization-proposal による提案ベースの最適化をご利用ください。"
)


def _retired_response() -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={
            "detail": _LEGACY_ENDPOINT_RETIRED_DETAIL,
            "error_code": "LEGACY_ENDPOINT_RETIRED",
        },
    )


@router.post("/travel-plans/{plan_id}/optimize")
async def optimize_travel_plan_retired(
    plan_id: str,
    optimization_data: Dict[str, Any] = Body(default={}),
):
    """[Gate #34] 廃止。plan.itineraryを書き換える旧ジョブ発行APIだった。"""
    _retired_response()


@router.get("/optimization/{job_id}")
async def get_optimization_result_retired(job_id: str):
    """[Gate #34] 廃止。旧ジョブ結果取得API。"""
    _retired_response()


@router.post("/optimization/{job_id}/apply")
async def apply_optimization_result_retired(job_id: str):
    """[Gate #34] 廃止。plan.itineraryへ直接書き込んでいた旧apply API。"""
    _retired_response()


@router.post("/optimization/{job_id}/cancel")
async def cancel_optimization_result_retired(job_id: str):
    """[Gate #34] 廃止。旧ジョブ取消API。"""
    _retired_response()


@router.post("/optimize-route")
async def optimize_route_retired(route_data: Dict[str, Any] = Body(default={})):
    """[Gate #34] 廃止。waypoints単体並べ替えの軽量エンドポイント。"""
    _retired_response()
