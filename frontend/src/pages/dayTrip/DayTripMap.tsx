/**
 * [FR-061] ルートと寄り道の地図(Leaflet + OpenStreetMap。後から読む)。
 * ルートの線・幅の帯(半透明)・出発地の点・目的地の旗・番号付きの候補(ジャンルの形)・保存済みの行きたい場所(♡)。
 */
import React, { useEffect } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AlongResult, AlongWish } from '@/services/api/dayTrip';

type LL = [number, number];

const pin = (n: number, selected: boolean, saved: boolean) => L.divIcon({
  html: `<span class="tc-spot-pin${selected ? ' is-selected' : ''}" style="--pin:#2f6f8f">${n}${saved ? '<span class="tc-spot-pin__star" aria-hidden="true">♡</span>' : ''}</span>`,
  className: '', iconSize: [selected ? 44 : 36, selected ? 44 : 36], iconAnchor: [selected ? 22 : 18, selected ? 22 : 18],
});
const heart = L.divIcon({ html: '<span class="tc-spot-meet" aria-hidden="true">♡</span>', className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
const flag = L.divIcon({ html: '<span class="tc-spot-meet" aria-hidden="true">旗</span>', className: '', iconSize: [28, 28], iconAnchor: [14, 28] });

const Fit: React.FC<{ line: LL[]; fitKey: string }> = ({ line, fitKey }) => {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => {
      map.invalidateSize();
      if (line.length > 1) map.fitBounds(L.latLngBounds(line), { padding: [30, 30] });
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
};

export interface DayTripMapProps {
  line: LL[]; widthM: number; results: AlongResult[]; wishes: AlongWish[]; selected: number | null; onSelect: (i: number) => void;
  straight: boolean; fitKey: string;
}

const DayTripMap: React.FC<DayTripMapProps> = ({ line, widthM, results, wishes, selected, onSelect, straight, fitKey }) => {
  const start = line[0];
  const end = line[line.length - 1];
  // 幅の帯: 地図の縮尺で太さが変わるので目安(ズーム 11 で 1km ≒ 13px)
  const bandPx = Math.max(6, Math.min(80, (widthM / 1000) * 26));
  return (
    <MapContainer center={start ?? [35.68, 139.76]} zoom={10} className="tc-daytrip-map" scrollWheelZoom aria-label="ルートの地図">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit line={line} fitKey={fitKey} />
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#2f6f8f', weight: bandPx, opacity: 0.15 }} />}
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#2f6f8f', weight: 4, dashArray: straight ? '6 6' : undefined }} />}
      {start && <CircleMarker center={start} radius={7} pathOptions={{ color: '#1f2937', fillColor: '#fff', fillOpacity: 1 }}><Tooltip>出発地</Tooltip></CircleMarker>}
      {end && <Marker position={end} icon={flag} title="目的地" alt="目的地" keyboard={false}><Tooltip>目的地</Tooltip></Marker>}
      {wishes.map((w) => <Marker key={w.spot_id} position={[w.lat, w.lng]} icon={heart} title={`行きたい場所: ${w.name}`}
        alt={`行きたい場所: ${w.name}`} keyboard={false}><Tooltip>{`行きたい場所: ${w.name}`}</Tooltip></Marker>)}
      {results.map((r, i) => (
        <Marker key={`${r.name}-${r.lat}`} position={[r.lat, r.lng]} icon={pin(i + 1, selected === i, !!r.saved_spot_id)}
          title={`${i + 1}. ${r.name}`} alt={`${i + 1}. ${r.name}`} eventHandlers={{ click: () => onSelect(i) }}>
          <Tooltip>{`${i + 1}. ${r.name}`}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default DayTripMap;
