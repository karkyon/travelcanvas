/**
 * [Gate TDay] 当日の地図(Leaflet + OpenStreetMap。PlanMap と同じ provider 方針。APIキー不要)。
 * 旅程の番号と地図のピンを同じにし、済(印)・NOW・NEXT・雨の時間・寄り道の候補を印の形と文字で分ける。
 * 足跡の線は「済んだ予定を順に結んだ線」(位置の記録そのものは出さない)。座標の無い予定は地図に出さない。
 * 後から読む(React.lazy)ため、当日の画面の最初の読み込みを重くしない。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { TodayEvent } from '@/services/api';
import type { DetourCandidate } from '@/services/api/travelDay';
import { formatTimeInZone } from '../todayModel';
import { sealGlyph } from './todayLive';

type PinState = 'done' | 'now' | 'next' | 'rain' | 'todo';

const icon = (text: string, state: PinState | 'detour') => L.divIcon({
  html: `<span class="tc-tmap__pin" data-state="${state}">${text.replace(/[<>&"']/g, '')}</span>`,
  className: '', iconSize: state === 'now' ? [34, 34] : [28, 28], iconAnchor: state === 'now' ? [17, 17] : [14, 14],
});

const Fit: React.FC<{ points: [number, number][]; full: boolean }> = ({ points, full }) => {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0]!, 15);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    }, 50);
    return () => window.clearTimeout(t);
  }, [map, points, full]);
  return null;
};

const TodayMap: React.FC<{
  events: TodayEvent[]; timeZone: string | null; nowId: string | null; nextId: string | null; doneIds: Set<string>;
  visitedIds: Set<string>; rainIds: Set<string>; detours?: DetourCandidate[]; onSelect?: (eventId: string) => void;
}> = ({ events, timeZone, nowId, nextId, doneIds, visitedIds, rainIds, detours = [], onSelect }) => {
  const [full, setFull] = useState(false);
  const placed = useMemo(() => events.map((e, i) => ({ e, i }))
    .filter(({ e }) => e.latitude != null && e.longitude != null), [events]);
  const points = useMemo(() => [
    ...placed.map(({ e }) => [e.latitude!, e.longitude!] as [number, number]),
    ...detours.filter((d) => d.latitude != null && d.longitude != null).map((d) => [d.latitude!, d.longitude!] as [number, number]),
  ], [placed, detours]);
  useEffect(() => {
    if (!full) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  if (placed.length === 0) return null;
  const stateOf = (id: string): PinState => id === nowId ? 'now' : id === nextId ? 'next'
    : visitedIds.has(id) || doneIds.has(id) ? 'done' : rainIds.has(id) ? 'rain' : 'todo';
  const pastIdx = placed.findIndex(({ e }) => !(doneIds.has(e.id) || visitedIds.has(e.id) || e.id === nowId));
  const cut = pastIdx === -1 ? placed.length : pastIdx;
  const walked = placed.slice(0, Math.max(cut, 0)).map(({ e }) => [e.latitude!, e.longitude!] as [number, number]);
  const ahead = placed.slice(Math.max(cut - 1, 0)).map(({ e }) => [e.latitude!, e.longitude!] as [number, number]);
  return (
    <section className={`tc-live-card tc-tmap${full ? ' is-full' : ''}`} aria-labelledby="today-map-title" data-testid="today-map">
      <div className="tc-tmap__head">
        <h2 id="today-map-title">当日の地図</h2>
        <span className="tc-live-muted">旅程と同じ番号</span>
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" style={{ marginLeft: 'auto' }}
          onClick={() => setFull((v) => !v)} aria-pressed={full}>
          {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          {full ? '閉じる' : '広げる'}
        </button>
      </div>
      <div className="tc-tmap__canvas">
        <MapContainer center={points[0]!} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom={full}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Fit points={points} full={full} />
          {walked.length > 1 && <Polyline positions={walked} pathOptions={{ color: '#b23c22', weight: 5, opacity: 0.9 }} />}
          {ahead.length > 1 && <Polyline positions={ahead} pathOptions={{ color: '#0f6e66', weight: 4, dashArray: '8 8' }} />}
          {placed.map(({ e, i }) => {
            const st = stateOf(e.id);
            const text = st === 'now' ? 'NOW' : st === 'done' ? sealGlyph(e.title, e.event_type).slice(0, 1) : String(i + 1);
            const word = { now: '今いる場所', next: '次の場所', done: '済', rain: '雨の時間', todo: 'この後' }[st];
            return (
              <Marker key={e.id} position={[e.latitude!, e.longitude!]} icon={icon(text, st)}
                eventHandlers={{ click: () => onSelect?.(e.id) }} title={`${e.title}(${word})`}>
                <Tooltip direction="top" offset={[0, -14]}>{`${formatTimeInZone(e.start_at, timeZone)} ${e.title}(${word})`}</Tooltip>
              </Marker>
            );
          })}
          {detours.filter((d) => d.latitude != null && d.longitude != null).map((d, i) => (
            <Marker key={`d-${d.name}`} position={[d.latitude!, d.longitude!]} icon={icon(String.fromCharCode(65 + i), 'detour')}
              title={`寄り道の候補 ${d.name}`}>
              <Tooltip direction="top" offset={[0, -14]}>{`寄り道 ${d.name}`}</Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="tc-tmap__legend">
        <span><b style={{ color: '#b23c22' }}>━</b> 今日の足跡(済んだ予定を結ぶ)</span>
        <span><b style={{ color: 'var(--tc-accent)' }}>┅</b> この後の道のり</span>
        {rainIds.size > 0 && <span><b style={{ color: 'var(--tc-info)' }}>○</b> 雨の時間にかかる</span>}
        {detours.length > 0 && <span><b style={{ color: '#8a5a12' }}>A</b> 寄り道の候補</span>}
      </div>
    </section>
  );
};

export default TodayMap;
