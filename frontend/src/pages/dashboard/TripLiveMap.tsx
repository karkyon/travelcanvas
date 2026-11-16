/**
 * [Gate HomeLive] 旅行中のホームの地図(Leaflet + OpenStreetMap。今日の画面の地図と同じ提供元。キー不要)。
 * 今日の流れと同じ予定・同じ番号。印の形と文字で いま・次・済み・この後 を分ける(色だけに頼らない)。
 * 印を押すと今日の流れの予定も選ばれ、流れで選ぶと地図がその場所へ動く。座標の無い予定は出さない。後から読む(React.lazy)。
 */
import React, { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TodayEvent } from '@/services/api';
import { formatTimeInZone } from '@/pages/today/todayModel';
import { LIVE_STATE_LABEL, liveState, type LiveState } from './tripLiveModel';

const clean = (t: string) => t.replace(/[<>&"']/g, '');
const pin = (text: string, state: LiveState, selected: boolean) => L.divIcon({
  html: `<span class="tc-live-pin${selected ? ' is-selected' : ''}" data-state="${state}">${clean(text)}</span>`,
  className: '', iconSize: [30, 30], iconAnchor: [15, 15],
});

const Fit: React.FC<{ points: [number, number][]; focus: [number, number] | null }> = ({ points, focus }) => {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    if (points.length === 1) map.setView(points[0]!, 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  useEffect(() => { if (focus) map.panTo(focus); }, [map, focus]);
  return null;
};

const TripLiveMap: React.FC<{
  events: TodayEvent[]; timeZone: string | null; nowId: string | null; nextId: string | null; doneIds: readonly string[];
  selectedId: string | null; onSelect: (id: string) => void;
}> = ({ events, timeZone, nowId, nextId, doneIds, selectedId, onSelect }) => {
  const placed = useMemo(() => events.map((e, i) => ({ e, i })).filter(({ e }) => e.latitude != null && e.longitude != null), [events]);
  const points = useMemo(() => placed.map(({ e }) => [e.latitude!, e.longitude!] as [number, number]), [placed]);
  if (points.length === 0) return null;
  const sel = selectedId ? placed.find(({ e }) => e.id === selectedId) : null;
  return (
    <MapContainer center={points[0]!} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} attributionControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={points} focus={sel ? [sel.e.latitude!, sel.e.longitude!] : null} />
      {points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#0f6e66', weight: 4, dashArray: '8 8' }} />}
      {placed.map(({ e, i }) => {
        const st = liveState(e.id, nowId, nextId, doneIds);
        const text = st === 'now' ? '今' : st === 'next' ? '次' : st === 'done' ? '済' : String(i + 1);
        return (
          <Marker key={e.id} position={[e.latitude!, e.longitude!]} icon={pin(text, st, e.id === selectedId)}
            title={`${e.title}(${LIVE_STATE_LABEL[st]})`} eventHandlers={{ click: () => onSelect(e.id) }}>
            <Tooltip direction="top" offset={[0, -14]}>{`${formatTimeInZone(e.start_at, timeZone)} ${e.title}(${LIVE_STATE_LABEL[st]})`}</Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
  );
};

export default TripLiveMap;
