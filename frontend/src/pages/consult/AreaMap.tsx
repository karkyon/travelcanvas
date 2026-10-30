/**
 * [Gate G11] 方面の比較の地図(OpenStreetMap のタイル。キー不要。PlanMap と同じ提供元)。
 * 出発地と、位置を照会できた方面だけを置く(照会できない方面は地図に置かず、一覧に「未照会」と出す)。
 * 線は直線(道路の経路ではない)。ピンと一覧の選択はそろえる。
 */
import React, { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // 地図の画像・印の位置を決める CSS(無いと地図の画像がばらばらに並ぶ)

export interface AreaPin {
  name: string;
  order: number;
  latitude: number;
  longitude: number;
  selected: boolean;
}

function icon(html: string, size = 30) {
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

const Fit: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0]!, 9);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36] });
  }, [map, points]);
  return null;
};

const AreaMap: React.FC<{ origin: { label: string; latitude: number; longitude: number } | null; pins: AreaPin[];
  onSelect: (name: string) => void }> = ({ origin, pins, onSelect }) => {
  const points = useMemo<[number, number][]>(() => [
    ...(origin ? [[origin.latitude, origin.longitude] as [number, number]] : []),
    ...pins.map((p) => [p.latitude, p.longitude] as [number, number]),
  ], [origin, pins]);
  const center: [number, number] = points[0] ?? [35.0, 135.7];
  return (
    <MapContainer center={center} zoom={7} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}
      attributionControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={points} />
      {origin && (
        <Marker position={[origin.latitude, origin.longitude]} keyboard={false}
          icon={icon('<div style="width:22px;height:22px;border-radius:9999px;background:#c2410c;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', 22)}>
          <Tooltip permanent direction="top" offset={[0, -10]}>{`出発地: ${origin.label}`}</Tooltip>
        </Marker>
      )}
      {origin && pins.map((p) => (
        <Polyline key={`l-${p.name}`} positions={[[origin.latitude, origin.longitude], [p.latitude, p.longitude]]}
          pathOptions={{ color: p.selected ? '#0f6e66' : '#64748b', weight: p.selected ? 3 : 2, dashArray: '6 6', opacity: 0.8 }} />
      ))}
      {pins.map((p) => (
        <Marker key={p.name} position={[p.latitude, p.longitude]} keyboard={false}
          eventHandlers={{ click: () => onSelect(p.name) }}
          icon={icon(`<div style="display:grid;place-items:center;width:30px;height:30px;border-radius:9999px;background:${
            p.selected ? '#0f6e66' : '#334155'};color:#fff;font-weight:700;font-size:13px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${p.order}</div>`)}>
          <Tooltip direction="top" offset={[0, -14]}>{`${p.order}. ${p.name}`}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default AreaMap;
