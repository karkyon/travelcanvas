/**
 * [Gate SpotMode] FR-060 スポットマップ(Leaflet + OpenStreetMap。当日の地図と同じ provider 方針。API キー不要)。
 *
 * - エリアの範囲(点線の円)・今いる場所と徒歩 3 分・5 分の輪・集合の場所
 * - 候補の印: 番号 + ジャンルの色(色だけに頼らず、一覧と詳しい所に名前を出す)。行きたいは星、済みは白抜きのチェック
 * - 選んだ候補への線・回れる道順の案の線は「直線の目安」(道順ではない。凡例に書く)
 * 後から読む(React.lazy)ため、スポットモードの最初の読み込みを重くしない。
 */
import React, { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SpotItem } from '@/services/api/types/spotAreas';
import { GENRE_META, WALK_M_PER_MIN, isDone, pointOf, type LatLng } from './spotModel';

const pinIcon = (n: number, item: SpotItem, selected: boolean, dim: boolean) => {
  const g = GENRE_META[item.genre];
  const done = isDone(item);
  const star = item.priority === 'want' && !done ? '<span class="tc-spot-pin__star" aria-hidden="true">★</span>' : '';
  const size = selected ? 44 : 36;
  return L.divIcon({
    html: `<span class="tc-spot-pin${selected ? ' is-selected' : ''}${done ? ' is-done' : ''}${dim ? ' is-dim' : ''}" style="--pin:${g.color}">${done ? '✓' : n}${star}</span>`,
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
};

const meetIcon = L.divIcon({ html: '<span class="tc-spot-meet">P</span>', className: '', iconSize: [28, 28], iconAnchor: [14, 14] });

const Fit: React.FC<{ points: LatLng[]; focus: LatLng | null; fitKey: string }> = ({ points, focus, fitKey }) => {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0]!, 17);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 18 });
    }, 60);
    return () => window.clearTimeout(t);
    // 「全体を表示」(fitKey が変わる)と点の並びが変わった時だけ合わせ直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  useEffect(() => {
    if (focus) map.panTo(focus);
  }, [map, focus]);
  return null;
};

export interface SpotMapProps {
  items: SpotItem[];
  numbers: Record<string, number>;
  visible: (i: SpotItem) => boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  me: LatLng | null;
  center: LatLng | null;
  radiusM: number;
  meet: LatLng | null;
  meetLabel: string | null;
  line: LatLng[] | null;
  focus: LatLng | null;
  fitKey: string;
  extraPins?: Array<{ key: string; point: LatLng; label: string }>;
}

const SpotLeafletMap: React.FC<SpotMapProps> = ({ items, numbers, visible, selectedId, onSelect, me, center, radiusM, meet,
  meetLabel, line, focus, fitKey, extraPins = [] }) => {
  const pts = items.map(pointOf).filter((p): p is LatLng => !!p);
  const all = [...pts, ...(meet ? [meet] : [])];
  const start: LatLng = center ?? pts[0] ?? me ?? [35.681, 139.767];
  return (
    <MapContainer center={start} zoom={16} className="tc-spot-map__leaflet" zoomControl={false} attributionControl
      aria-label="スポットマップ">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      <Fit points={all.length ? all : [start]} focus={focus} fitKey={`${fitKey}|${all.length}`} />
      {center && <Circle center={center} radius={radiusM} pathOptions={{ color: '#0f6e66', weight: 1.5, dashArray: '6 6', fillOpacity: 0.06 }} />}
      {me && (
        <>
          <Circle center={me} radius={WALK_M_PER_MIN * 3} pathOptions={{ color: '#1d4ed8', weight: 1, dashArray: '3 5', fill: false, opacity: 0.5 }} />
          <Circle center={me} radius={WALK_M_PER_MIN * 5} pathOptions={{ color: '#1d4ed8', weight: 1, dashArray: '3 5', fill: false, opacity: 0.35 }} />
          <CircleMarker center={me} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }}>
            <Tooltip>今いる場所</Tooltip>
          </CircleMarker>
        </>
      )}
      {meet && <Marker position={meet} icon={meetIcon}><Tooltip>集合: {meetLabel ?? '集合の場所'}</Tooltip></Marker>}
      {line && line.length > 1 && (
        <Polyline positions={line} pathOptions={{ color: '#0f6e66', weight: 5, dashArray: '2 8', lineCap: 'round' }}>
          <Tooltip sticky>直線の目安(道順ではありません)</Tooltip>
        </Polyline>
      )}
      {items.map((i) => {
        const p = pointOf(i);
        if (!p) return null;
        return (
          <Marker key={i.id} position={p} icon={pinIcon(numbers[i.id] ?? 0, i, i.id === selectedId, !visible(i))}
            eventHandlers={{ click: () => onSelect(i.id) }} title={`${numbers[i.id]} ${i.title}(${GENRE_META[i.genre].label})`}
            keyboard alt={`${numbers[i.id]} ${i.title}`} />
        );
      })}
      {extraPins.map((x) => (
        <CircleMarker key={x.key} center={x.point} radius={9} pathOptions={{ color: '#0f6e66', weight: 2, dashArray: '3 3', fillColor: '#ffffff', fillOpacity: 1 }}>
          <Tooltip>{x.label}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
};

export default SpotLeafletMap;
