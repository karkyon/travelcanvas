/**
 * PlanMap - PLAN MAP基礎(Gate #32)
 *
 * [Gate #32] 監査是正: 既存のMapView.tsx(Google Maps JavaScript API)は
 * VITE_GOOGLE_MAPS_API_KEY未提供のままどのページからも呼ばれておらず、
 * ghost codeだった。v5.1仕様のGate #32セクションが明示する「provider
 * 非依存adapter」「APIキーなしfixture route provider」という方針に従い、
 * Leaflet + OpenStreetMapタイル(APIキー不要、Gate #31のNominatim/
 * Overpassと同じ無料provider方針)を採用する。
 *
 * 表現する要素(v5.1 MAP Interaction Model準拠、簡略版):
 * - 予定(scheduled): 日別色の番号付き丸ピン
 * - 候補(candidate): 星ピン
 * - 座標不明の地点は地図上に表示せず、下部の「位置不明」リストへ回す
 *   (架空の座標を作らない)。
 *
 * 双方向同期: マーカー選択でtimeline側へ通知(onSelectEvent)、逆に
 * timeline側で選択されたeventIdをselectedEventIdとして受け取りハイライト
 * する。
 */
import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { DaySchedule, ScheduleItem } from '@/types';
import type { SpotResult, RoutePreview } from '@/services/api';

interface PlanMapProps {
  day: DaySchedule | null;
  candidates?: SpotResult[];
  routePreview?: RoutePreview | null;
  selectedEventId?: string | null;
  onSelectEvent?: (eventId: string) => void;
  onAddCandidateToItinerary?: (candidateId: string, fallbackTitle: string) => void;
  className?: string;
}

function _divIcon(html: string, size: [number, number] = [28, 28]) {
  return L.divIcon({
    html,
    className: '',
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1]],
    popupAnchor: [0, -size[1]],
  });
}

function scheduledIcon(order: number, isSelected: boolean) {
  const bg = isSelected ? '#1d4ed8' : '#3b82f6';
  const ring = isSelected ? '0 0 0 3px rgba(29,78,216,0.35)' : 'none';
  return _divIcon(
    `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bg};color:white;font-size:12px;font-weight:700;box-shadow:${ring}, 0 1px 3px rgba(0,0,0,0.3);border:2px solid white;">${order}</div>`
  );
}

function candidateIcon() {
  return _divIcon(
    `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:white;color:#f59e0b;font-size:15px;border:2px solid #f59e0b;box-shadow:0 1px 3px rgba(0,0,0,0.3);">★</div>`
  );
}

// 地図の表示範囲を、表示中のマーカー群に合わせて自動調整する。
const FitBounds: React.FC<{ positions: [number, number][] }> = ({ positions }) => {
  const map = useMap();
  React.useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0]!, 14);
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] });
  }, [map, positions]);
  return null;
};

const PlanMap: React.FC<PlanMapProps> = ({
  day,
  candidates = [],
  routePreview,
  selectedEventId,
  onSelectEvent,
  onAddCandidateToItinerary,
  className = '',
}) => {
  const scheduledWithCoords = useMemo(
    () => (day?.events ?? []).filter(
      (e): e is ScheduleItem & { latitude: number; longitude: number } =>
        e.latitude !== undefined && e.longitude !== undefined
    ),
    [day]
  );
  const scheduledUnknown = useMemo(
    () => (day?.events ?? []).filter((e) => e.latitude === undefined || e.longitude === undefined),
    [day]
  );

  const candidatesWithCoords = useMemo(
    () => candidates.filter(
      (c): c is SpotResult & { location: { latitude: number; longitude: number } } =>
        c.location.latitude !== undefined && c.location.longitude !== undefined
    ),
    [candidates]
  );
  const candidatesUnknown = useMemo(
    () => candidates.filter((c) => c.location.latitude === undefined || c.location.longitude === undefined),
    [candidates]
  );

  const allPositions: [number, number][] = useMemo(() => [
    ...scheduledWithCoords.map((e): [number, number] => [e.latitude, e.longitude]),
    ...candidatesWithCoords.map((c): [number, number] => [c.location.latitude, c.location.longitude]),
  ], [scheduledWithCoords, candidatesWithCoords]);

  const routeLine: [number, number][] = useMemo(
    () => scheduledWithCoords.map((e): [number, number] => [e.latitude, e.longitude]),
    [scheduledWithCoords]
  );

  const hasAnyKnownLocation = allPositions.length > 0;
  const defaultCenter: [number, number] = [35.6812, 139.7671]; // 東京駅(何も無い場合の初期表示のみ)

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 420 }}>
        <MapContainer
          center={hasAnyKnownLocation ? allPositions[0] : defaultCenter}
          zoom={13}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          {/* [Gate #32] OpenStreetMapタイル。APIキー不要。 */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {hasAnyKnownLocation && <FitBounds positions={allPositions} />}

          {routeLine.length > 1 && (
            <Polyline positions={routeLine} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7 }} />
          )}

          {scheduledWithCoords.map((event, idx) => (
            <Marker
              key={event.id}
              position={[event.latitude, event.longitude]}
              icon={scheduledIcon(idx + 1, event.id === selectedEventId)}
              eventHandlers={{ click: () => onSelectEvent?.(event.id) }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{idx + 1}. {event.title}</p>
                  {event.start_time && <p className="text-gray-500">{event.start_time}</p>}
                </div>
              </Popup>
            </Marker>
          ))}

          {candidatesWithCoords.map((candidate) => (
            <Marker
              key={candidate.id}
              position={[candidate.location.latitude, candidate.location.longitude]}
              icon={candidateIcon()}
            >
              <Popup>
                <div className="text-sm space-y-2">
                  <p className="font-semibold">{candidate.name}</p>
                  <p className="text-gray-500 text-xs">{candidate.provider}経由の候補</p>
                  {onAddCandidateToItinerary && candidate.candidate_id && (
                    <button
                      className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                      onClick={() => onAddCandidateToItinerary(candidate.candidate_id!, candidate.name)}
                    >
                      旅程に追加
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {routePreview && (
        <div className="text-xs text-gray-500 px-1">
          {routePreview.total_distance_km != null && routePreview.total_duration_minutes != null ? (
            <span>
              この日の移動概算: 約{routePreview.total_distance_km}km・約{Math.round(routePreview.total_duration_minutes)}分
              <span className="text-gray-400">(直線距離ベースの概算、確定値ではありません)</span>
            </span>
          ) : (
            <span className="text-gray-400">一部区間の移動概算は算出できません(位置情報不明の地点を含みます)</span>
          )}
        </div>
      )}

      {(scheduledUnknown.length > 0 || candidatesUnknown.length > 0) && (
        <div className="text-xs text-gray-500 px-1 space-y-1">
          {scheduledUnknown.length > 0 && (
            <p>位置情報不明の予定: {scheduledUnknown.map((e) => e.title).join('、')}</p>
          )}
          {candidatesUnknown.length > 0 && (
            <p>位置情報不明の候補: {candidatesUnknown.map((c) => c.name).join('、')}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default PlanMap;
