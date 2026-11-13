/**
 * PlanMap - PLAN MAP基礎(Gate #32)
 *
 * [Gate #32] 監査是正: 既存のMapView.tsx(Google Maps JavaScript API)は
 * ブラウザ用の鍵が未提供のままどのページからも呼ばれておらず(Gate SecretPolicy で削除済み)、
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import RouteSummaryLine, { type RouteSummaryStatus } from './RouteSummaryLine';
import { hasCoords, mapNumbers } from './mapNumberModel';
import { buildMapLegs, legsSignature, type LegSegment, type MapLeg } from './routeLegsModel';
import { getRouteGeometry, type RouteGeometry } from '@/services/api/routeGeometry';
import { Circle, MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // 地図の画像・印の位置を決める CSS(無いと地図の画像がばらばらに並ぶ)
import type { DaySchedule, ScheduleItem } from '@/types';
import { areaCircles } from './areaModel';
import type { SpotResult, RoutePreview } from '@/services/api';

interface PlanMapProps {
  day: DaySchedule | null;
  candidates?: SpotResult[];
  routePreview?: RoutePreview | null;
  /** [G11-Layout] 移動概算の読み込みの状態(場所を確保するため。'off' は行を出さない) */
  routePreviewStatus?: RouteSummaryStatus;
  selectedEventId?: string | null;
  onSelectEvent?: (eventId: string) => void;
  onAddCandidateToItinerary?: (candidateId: string, fallbackTitle: string) => void;
  className?: string;
  /** [Gate AppShell] 地図の高さ(旅程の3列では 530px)。[Gate MapTools] 最大化の時は CSS の長さ */
  height?: number | string;
  /** [Gate TimelineRedesign] 最初の予定の印の横に出す出発の札(例: 「出発: 自宅から 08:00」) */
  startLabel?: string | null;
  /** [Gate RoadRoute] 道に沿った経路を聞く旅行(無ければ直線のまま) */
  planId?: string | null;
  /** [Gate RoadRoute] 移動区間(区間の手段で道の種類を決める。控えの案を開いている時はその案の区間) */
  segments?: ReadonlyArray<LegSegment>;
}

const MODE_LABEL: Record<string, string> = {
  walking: '徒歩', driving: '車', taxi: 'タクシー', bus: 'バス', express_bus: '高速バス', bicycle: '自転車',
  train: '電車', shinkansen: '新幹線', flight: '飛行機', ferry: '船', helicopter: 'ヘリ', mixed: '複合',
};
const ROUTE_STRAIGHT = '#334155';

/** [Gate RoadRoute] 区間の線の説明(手段・道の目安の時間と距離。推測した手段は「手段は推測」) */
function legTip(leg: MapLeg, g: RouteGeometry['legs'][number] | undefined): string {
  const mode = MODE_LABEL[leg.mode] ?? leg.mode;
  const guess = leg.source === 'guess' ? '(手段は推測)' : '';
  if (g && g.kind === 'road') {
    const parts = [
      typeof g.duration_minutes === 'number' ? `約${Math.max(1, Math.round(g.duration_minutes))}分` : null,
      typeof g.distance_km === 'number' ? `${g.distance_km.toFixed(1)}km` : null,
    ].filter(Boolean).join('・');
    return `${mode}${guess} 道に沿った経路${parts ? ` ${parts}` : ''}`;
  }
  return `${mode}${guess} 直線(道の経路なし・目安)`;
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

// [Gate EventArea] エリアとその中の予定は同じ色(エリアの範囲の円と合わせる)
const AREA_COLOR = '#0e7c6b';

/**
 * [Gate TimelineRedesign] 予定の印: 旅程のカードと同じ番号のしずく形。選んだ予定は赤(カードの番号と同じ色)で大きく、
 * エリアとその中の予定はエリアの緑。
 */
export const PIN_SELECTED = '#dc2626';
const PIN_PLANNED = '#0f6e66';
function scheduledIcon(order: number, isSelected: boolean, inArea = false) {
  const bg = isSelected ? PIN_SELECTED : inArea ? AREA_COLOR : PIN_PLANNED;
  const size = isSelected ? 38 : 30;
  const ring = isSelected ? 'box-shadow:0 0 0 6px rgba(220,38,38,.25),0 2px 6px rgba(0,0,0,.35);' : 'box-shadow:0 2px 5px rgba(0,0,0,.3);';
  return _divIcon(
    `<div class="tc-pin${isSelected ? ' is-sel' : ''}" style="width:${size}px;height:${size}px;background:${bg};${ring}">`
      + `<span style="font-size:${isSelected ? 15 : 13}px">${order}</span></div>`,
    [size, Math.round(size * 1.21)],
  );
}

function candidateIcon() {
  return _divIcon(
    `<div class="tc-pin is-cand" style="width:28px;height:28px"><span>☆</span></div>`, [28, 34],
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

// [Gate MapFloatTimeline] 選んだ予定の印が地図の外なら、そこへ動かす(見えていれば動かさない)
const PanToSelected: React.FC<{ position: [number, number] | null }> = ({ position }) => {
  const map = useMap();
  const lat = position?.[0];
  const lng = position?.[1];
  React.useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    const target = L.latLng(lat, lng);
    if (!map.getBounds().pad(-0.1).contains(target)) map.panTo(target, { animate: true });
  }, [map, lat, lng]);
  return null;
};

const PlanMap: React.FC<PlanMapProps> = ({
  day,
  candidates = [],
  routePreview,
  routePreviewStatus,
  selectedEventId,
  onSelectEvent,
  onAddCandidateToItinerary,
  className = '',
  height = 420,
  startLabel = null,
  planId = null,
  segments,
}) => {
  const scheduledWithCoords = useMemo(
    () => (day?.events ?? []).filter(
      (e): e is ScheduleItem & { latitude: number; longitude: number } => hasCoords(e)
    ),
    [day]
  );
  const scheduledUnknown = useMemo(
    () => (day?.events ?? []).filter((e) => !hasCoords(e)),
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

  // [Gate RoadRoute] 道に沿った経路(OSRM)。聞けない・無い区間は直線の点線(架空の道を作らない)
  const legs = useMemo(() => buildMapLegs(scheduledWithCoords, segments ?? []), [scheduledWithCoords, segments]);
  const sig = useMemo(() => legsSignature(legs), [legs]);
  const [geo, setGeo] = useState<{ sig: string; data: RouteGeometry } | null>(null);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!planId || legs.length === 0) return undefined;
    const want = `${planId}#${sig}`;
    if (asked.current === want) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      asked.current = want;
      getRouteGeometry(planId, legs.map((l) => ({
        from_lat: l.from[0], from_lng: l.from[1], to_lat: l.to[0], to_lng: l.to[1], mode: l.mode,
      })))
        .then((data) => { if (alive) setGeo({ sig, data }); })
        .catch(() => { if (alive) { asked.current = null; setGeo(null); } });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [planId, legs, sig]);
  const selectedPos = useMemo((): [number, number] | null => {
    const e = scheduledWithCoords.find((x) => x.id === selectedEventId);
    return e && typeof e.latitude === 'number' && typeof e.longitude === 'number' ? [e.latitude, e.longitude] : null;
  }, [scheduledWithCoords, selectedEventId]);
  const geoLegs = geo && geo.sig === sig && geo.data.legs.length === legs.length ? geo.data.legs : null;

  const areas = useMemo(() => areaCircles(day?.events ?? []), [day]);
  const nums = useMemo(() => mapNumbers(day?.events ?? []), [day]);

  const hasAnyKnownLocation = allPositions.length > 0;
  const defaultCenter: [number, number] = [35.6812, 139.7671]; // 東京駅(何も無い場合の初期表示のみ)

  // [Gate TimelineRedesign] height="100%": 旅程の欄と同じ高さに広げ、移動の概算と位置不明の予定は地図の下に重ねる
  const fill = height === '100%';
  return (
    <div className={fill ? `tc-planmap-fill ${className}` : `space-y-2 ${className}`}>
      <div className={fill ? 'tc-planmap-box' : 'rounded-xl overflow-hidden border border-gray-200'} style={fill ? undefined : { height }}>
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
          <PanToSelected position={selectedPos} />

          {geoLegs ? legs.map((leg, i) => {
            const g = geoLegs[i];
            const road = g?.kind === 'road' && g.coordinates.length > 1;
            const positions = road ? g!.coordinates.map((c): [number, number] => [c[0]!, c[1]!]) : [leg.from, leg.to];
            const pathOptions = road
              ? { color: PIN_PLANNED, weight: leg.source === 'guess' ? 3 : 4, opacity: leg.source === 'guess' ? 0.6 : 0.9 }
              : { color: ROUTE_STRAIGHT, weight: 4, opacity: 0.95, dashArray: '2 9', lineCap: 'round' as const };
            return (
              <Polyline key={`leg-${leg.key}-${i}`} positions={positions} pathOptions={pathOptions}>
                <Tooltip sticky className="tc-pin-tip">{legTip(leg, g)}</Tooltip>
              </Polyline>
            );
          }) : routeLine.length > 1 && (
            <Polyline positions={routeLine} pathOptions={{ color: PIN_PLANNED, weight: 3, opacity: 0.85, dashArray: '6 8' }} />
          )}

          {areas.map((a) => (
            <Circle key={`area-${a.id}`} center={a.center} radius={a.radius}
              pathOptions={{ color: AREA_COLOR, weight: 2, dashArray: '6 6', fillColor: AREA_COLOR, fillOpacity: 0.08 }}>
              <Tooltip direction="top" permanent className="tc-area-tip">{`${nums[a.id] !== undefined ? `${nums[a.id]} ` : ''}${a.title}`}</Tooltip>
            </Circle>
          ))}

          {scheduledWithCoords.map((event, idx) => {
            const n = nums[event.id] ?? idx + 1;
            const sel = event.id === selectedEventId;
            return (
              <Marker
                key={event.id}
                position={[event.latitude, event.longitude]}
                icon={scheduledIcon(n, sel, event.category === 'area' || Boolean(event.parent_event_id))}
                zIndexOffset={sel ? 1000 : 0}
                title={`${n}. ${event.title}`}
                eventHandlers={{ click: () => onSelectEvent?.(event.id) }}
              >
                {sel ? (
                  <Tooltip key="sel" permanent direction="bottom" offset={[0, 4]} className="tc-pin-tip is-sel">
                    {`${n} ${event.title}${event.start_time ? ` ${event.start_time.slice(0, 5)}` : ''}`}
                  </Tooltip>
                ) : idx === 0 && startLabel ? (
                  <Tooltip key="start" permanent direction="left" offset={[-16, -20]} className="tc-pin-tip is-start">{startLabel}</Tooltip>
                ) : (
                  <Tooltip key="hover" direction="top" offset={[0, -34]} className="tc-pin-tip">
                    {`${n} ${event.title}${event.start_time ? ` ${event.start_time.slice(0, 5)}` : ''}`}
                  </Tooltip>
                )}
              </Marker>
            );
          })}

          {candidatesWithCoords.map((candidate) => (
            <Marker
              key={candidate.id}
              position={[candidate.location.latitude, candidate.location.longitude]}
              icon={candidateIcon()}
            >
              <Popup>
                <div className="text-sm space-y-2">
                  <p className="font-semibold">{candidate.name}</p>
                  <p className="text-ink-500 text-xs">{candidate.provider}経由の候補</p>
                  {onAddCandidateToItinerary && candidate.candidate_id && (
                    <button
                      className="px-2 py-1 bg-blue-500 text-white rounded-sm text-xs hover:bg-blue-600"
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

      <div className={fill ? 'tc-planmap-foot' : undefined}>
      <RouteSummaryLine status={routePreviewStatus ?? (routePreview ? 'ready' : 'off')} preview={routePreview ?? null} />

      {(scheduledUnknown.length > 0 || candidatesUnknown.length > 0) && (
        <div className="text-xs text-ink-500 px-1 space-y-1">
          {scheduledUnknown.length > 0 && (
            <p>位置情報不明の予定: {scheduledUnknown.map((e) => e.title).join('、')}</p>
          )}
          {candidatesUnknown.length > 0 && (
            <p>位置情報不明の候補: {candidatesUnknown.map((c) => c.name).join('、')}</p>
          )}
        </div>
      )}
      </div>
    </div>
  );
};

export default PlanMap;
