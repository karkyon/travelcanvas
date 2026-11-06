/**
 * [Gate SpotLinks] スポットの編集の窓の地図。予定の位置を街の縮尺(既定 16)で出し、印を動かすと位置を直せる。
 * 地図は OpenStreetMap のタイル(旅程の地図 PlanMap と同じ。API キー不要)。位置が無い時は呼ばない(親が出さない)。
 */
import React, { useEffect, useMemo } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const SPOT_ZOOM = 16;

interface Props {
  latitude: number;
  longitude: number;
  /** 印を動かした時(渡さなければ動かせない) */
  onMove?: (latitude: number, longitude: number) => void;
  height?: number;
  label?: string;
}

const pin = L.divIcon({
  html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#0f6e66;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
  className: '', iconSize: [26, 26], iconAnchor: [13, 26],
});

/** 位置が変わったら地図の中心を合わせる(縮尺は今のまま) */
const Follow: React.FC<{ at: [number, number] }> = ({ at }) => {
  const map = useMap();
  useEffect(() => { map.setView(at, map.getZoom()); }, [map, at]);
  return null;
};

const SpotMiniMap: React.FC<Props> = ({ latitude, longitude, onMove, height = 220, label = '予定の場所' }) => {
  const at = useMemo<[number, number]>(() => [latitude, longitude], [latitude, longitude]);
  const handlers = useMemo(() => ({
    dragend: (e: L.LeafletEvent) => {
      const p = (e.target as L.Marker).getLatLng();
      onMove?.(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
    },
  }), [onMove]);
  return (
    <div className="overflow-hidden rounded-xl border border-cloud-200" style={{ height }} data-testid="spot-mini-map"
      role="region" aria-label={`${label}の地図`}>
      <MapContainer center={at} zoom={SPOT_ZOOM} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={at} icon={pin} draggable={Boolean(onMove)} eventHandlers={handlers}
          title={onMove ? `${label}(動かして位置を直せます)` : label} alt={label} keyboard={false} />
        <Follow at={at} />
      </MapContainer>
    </div>
  );
};

export default SpotMiniMap;
