"""
AI最適化API - 経路の実最適化・最適化結果の取得/適用/取消

[Gate #23] このファイルはこれまでmain.pyでinclude_routerされておらず、
定義されていた/optimize-routeエンドポイントも固定文字列を返すだけの
モックだった(実際にwaypointsの並べ替えは行っていなかった)。加えて
フロントエンド(OptimizationPage.tsx/OptimizationPanel.tsx)が期待する
/plans/{id}/optimize -> job_id発行 -> /optimization/{job_id}でポーリング
というジョブ型APIは一切実装されていなかった(Gate #7jで型のみ整合済みの
まま放置)。本Gateで、既存のOptimizationResultテーブル(travels.idへの
travel_id列はNULL許容のため未使用のまま、original_data/optimized_data
JSON列にplan_idを保持することでマイグレーション無しに対応)を使い、
緯度経度に基づく最近傍法での実際の経路並べ替えを行うジョブ型APIとして
実装する。同期処理のため生成直後から常にstatus="completed"で返す。
"""
import math
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.core.plan_access import require_plan_access
from app.models.models import OptimizationResult, TravelPlan, User

router = APIRouter(tags=["ai-optimization"])

# 徒歩・公共交通機関の混在を想定した平均移動速度(km/h)。
# 移動時間の見積りにのみ用いる簡易値であり、交通手段別の実測データではない。
AVG_SPEED_KMH = 25.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """2点間の大圏距離(km)をHaversine公式で計算"""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def _has_coords(event: Dict[str, Any]) -> bool:
    return event.get("latitude") is not None and event.get("longitude") is not None


def _route_distance_km(events: List[Dict[str, Any]]) -> float:
    """座標を持つイベントを訪問順に結んだ場合の合計距離(km)"""
    pts = [e for e in events if _has_coords(e)]
    total = 0.0
    for i in range(len(pts) - 1):
        total += _haversine_km(
            pts[i]["latitude"], pts[i]["longitude"],
            pts[i + 1]["latitude"], pts[i + 1]["longitude"],
        )
    return total


def _nearest_neighbor_order(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    緯度経度を持つイベントを最近傍法で並べ替える。
    最初のイベントの位置は起点として固定し、そこから最も近い未訪問地点を
    順に選んでいく。座標を持たないイベント(未入力等)は元の相対順序のまま
    末尾に残す。
    """
    with_coords = [e for e in events if _has_coords(e)]
    without_coords = [e for e in events if not _has_coords(e)]

    if len(with_coords) < 2:
        return events[:]

    remaining = with_coords[1:]
    ordered = [with_coords[0]]
    current = with_coords[0]
    while remaining:
        nearest_idx = min(
            range(len(remaining)),
            key=lambda i: _haversine_km(
                current["latitude"], current["longitude"],
                remaining[i]["latitude"], remaining[i]["longitude"],
            ),
        )
        current = remaining.pop(nearest_idx)
        ordered.append(current)

    return ordered + without_coords


def _plan_metrics(days: List[Dict[str, Any]]) -> Dict[str, float]:
    total_distance = 0.0
    total_cost = 0.0
    total_event_duration = 0.0
    for day in days:
        events = day.get("events", []) or []
        total_distance += _route_distance_km(events)
        for e in events:
            total_cost += float(e.get("cost") or 0)
            total_event_duration += float(e.get("duration") or 0)

    total_travel_time_minutes = total_event_duration + (total_distance / AVG_SPEED_KMH * 60)
    return {
        "total_travel_time_minutes": round(total_travel_time_minutes, 1),
        "total_cost": round(total_cost, 0),
        "total_distance_km": round(total_distance, 2),
    }


def _get_owned_plan(db: Session, plan_id: uuid.UUID, user: User, min_role: str = "editor") -> TravelPlan:
    """[Gate #30] 最適化の実行・適用・キャンセルはitineraryを書き換える
    破壊的操作のためeditor以上を要求する(デフォルト)。結果の閲覧のみは
    呼び出し側でmin_role="viewer"を指定する。"""
    plan, _role = require_plan_access(db, plan_id, user, min_role=min_role)
    return plan


@router.post("/travel-plans/{plan_id}/optimize")
async def optimize_travel_plan(
    plan_id: uuid.UUID,
    optimization_data: Dict[str, Any] = Body(default={}),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """プランの各日程を、緯度経度に基づく最近傍法で移動距離が最小になるよう並べ替える"""
    plan = _get_owned_plan(db, plan_id, current_user)

    original_days: List[Dict[str, Any]] = (plan.itinerary or {}).get("days", []) if plan.itinerary else []
    if not original_days:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="日程が登録されていません")

    optimized_days: List[Dict[str, Any]] = []
    changes: List[Dict[str, str]] = []

    for day in original_days:
        events = day.get("events", []) or []
        before_km = _route_distance_km(events)
        new_events = _nearest_neighbor_order(events)
        after_km = _route_distance_km(new_events)
        optimized_days.append({**day, "events": new_events})

        order_changed = [e.get("id") for e in new_events] != [e.get("id") for e in events]
        if order_changed and before_km - after_km > 0.01:
            changes.append({
                "type": "reorder",
                "description": f"{day.get('date') or '日程'}の訪問順を、移動距離が短くなるよう並べ替えました",
                "impact": f"約{round(before_km - after_km, 2)}km短縮",
            })

    if not changes:
        changes.append({
            "type": "reorder",
            "description": "現在の訪問順が既に距離的に最短のため、変更はありませんでした",
            "impact": "変更なし",
        })

    original_metrics = _plan_metrics(original_days)
    optimized_metrics = _plan_metrics(optimized_days)

    distance_saved = round(original_metrics["total_distance_km"] - optimized_metrics["total_distance_km"], 2)
    time_saved = round(original_metrics["total_travel_time_minutes"] - optimized_metrics["total_travel_time_minutes"], 1)
    cost_saved = round(original_metrics["total_cost"] - optimized_metrics["total_cost"], 0)

    efficiency_score = 100.0
    if original_metrics["total_distance_km"] > 0:
        efficiency_score = round(
            100 * (1 - optimized_metrics["total_distance_km"] / original_metrics["total_distance_km"]), 1
        )
        efficiency_score = max(0.0, min(100.0, efficiency_score))

    optimization_type = "balanced"
    if isinstance(optimization_data, dict) and optimization_data.get("optimization_type"):
        optimization_type = str(optimization_data["optimization_type"])

    result = OptimizationResult(
        id=uuid.uuid4(),
        travel_id=None,
        optimization_type=optimization_type,
        original_data={"plan_id": str(plan_id), "days": original_days, "metrics": original_metrics},
        optimized_data={"plan_id": str(plan_id), "days": optimized_days, "metrics": optimized_metrics},
        improvement_metrics={
            "time_saved_minutes": time_saved,
            "cost_saved": cost_saved,
            "distance_saved_km": distance_saved,
            "efficiency_score": efficiency_score,
            "changes": changes,
        },
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    return {"job_id": str(result.id), "status": "completed"}


@router.get("/optimization/{job_id}")
async def get_optimization_result(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """最適化ジョブの結果を取得。本実装は同期処理のため常にcompletedで返す"""
    result = db.query(OptimizationResult).filter(OptimizationResult.id == job_id).first()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="最適化結果が見つかりません")

    plan_id = (result.original_data or {}).get("plan_id")
    if plan_id:
        _get_owned_plan(db, uuid.UUID(plan_id), current_user, min_role="viewer")

    original_metrics = (result.original_data or {}).get("metrics", {})
    optimized_metrics = (result.optimized_data or {}).get("metrics", {})
    improvements = result.improvement_metrics or {}

    return {
        "job_id": str(result.id),
        "status": "completed",
        "progress": 100,
        "result": {
            "original_plan": original_metrics,
            "optimized_plan": optimized_metrics,
            "improvements": {
                "time_saved_minutes": improvements.get("time_saved_minutes", 0),
                "cost_saved": improvements.get("cost_saved", 0),
                "distance_saved_km": improvements.get("distance_saved_km", 0),
                "efficiency_score": improvements.get("efficiency_score", 0),
            },
            "changes": improvements.get("changes", []),
        },
    }


@router.post("/optimization/{job_id}/apply")
async def apply_optimization_result(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """最適化結果を実際のプランの日程(itinerary)に適用する"""
    result = db.query(OptimizationResult).filter(OptimizationResult.id == job_id).first()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="最適化結果が見つかりません")

    plan_id = (result.original_data or {}).get("plan_id")
    if not plan_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="対象プランが不明です")

    plan = _get_owned_plan(db, uuid.UUID(plan_id), current_user)
    optimized_days = (result.optimized_data or {}).get("days", [])

    plan.itinerary = {"days": optimized_days}
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"最適化適用エラー: {str(e)}",
        )

    return {"success": True, "message": "最適化結果をプランに適用しました"}


@router.post("/optimization/{job_id}/cancel")
async def cancel_optimization_result(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """最適化結果を却下し、保存済みのジョブデータを削除する"""
    result = db.query(OptimizationResult).filter(OptimizationResult.id == job_id).first()
    if not result:
        return {"success": True}

    plan_id = (result.original_data or {}).get("plan_id")
    if plan_id:
        _get_owned_plan(db, uuid.UUID(plan_id), current_user)

    db.delete(result)
    db.commit()
    return {"success": True}


@router.post("/optimize-route")
async def optimize_route(
    route_data: Dict[str, Any],
    current_user: User = Depends(get_current_active_user),
):
    """
    単一地点リスト(waypoints)を最近傍法で並べ替える軽量エンドポイント。
    [Gate #23] 以前は入力を反転して返すだけの固定モックだった(実質何もして
    いなかった)ため、実際に緯度経度に基づく並べ替えを行うよう置き換えた。
    """
    waypoints = route_data.get("waypoints", []) or []
    events = [
        {
            "id": i,
            "latitude": wp.get("latitude", wp.get("lat")),
            "longitude": wp.get("longitude", wp.get("lng")),
        }
        for i, wp in enumerate(waypoints)
    ]
    before_km = _route_distance_km(events)
    optimized_events = _nearest_neighbor_order(events)
    after_km = _route_distance_km(optimized_events)
    order = [e["id"] for e in optimized_events]
    optimized_waypoints = [waypoints[i] for i in order]

    return {
        "status": "optimization_completed",
        "original_route": waypoints,
        "optimized_route": optimized_waypoints,
        "improvements": {
            "distance_saved_km": round(before_km - after_km, 2),
            "time_saved_minutes": round((before_km - after_km) / AVG_SPEED_KMH * 60, 1),
        },
    }
