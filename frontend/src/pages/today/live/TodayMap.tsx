/**
 * [Gate TDay] 当日の地図(Leaflet + OpenStreetMap。PlanMap と同じ provider 方針。APIキー不要)。
 * 旅程の番号と地図のピンを同じにし、済(印)・NOW・NEXT・雨の時間・寄り道の候補を印の形と文字で分ける。
 * 足跡の線は「済んだ予定を順に結んだ線」。位置の設定で「今日の足跡を地図に描く」を ON にした人だけ、
 * この端末に置いた位置の点を結ぶ(送らない)。座標の無い予定は地図に出さない。
 *
 * [Gate TDay-Mock] variant:
 * - card: 今日の画面のカード(高さ固定・拡大は「地図を開く」)
 * - full: 地図の画面(絞り込み・地図の種類・今いる場所・選んだ場所)
 * - route: 宿へ帰る道など、決めた点だけ
 * 後から読む(React.lazy)ため、当日の画面の最初の読み込みを重くしない。
 */
import React, { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { EtaShare } from '@/services/api/travelDay';
import { formatTimeInZone } from '../todayModel';
import { sealGlyph } from './todayLive';
import { ALL_FILTERS, type MapFilters } from './mapFilters';
import type { TodayCtx } from './todayCtx';

type PinState = 'done' | 'now' | 'next' | 'rain' | 'todo';

const clean = (t: string) => t.replace(/[<>&"']/g, '');
const icon = (text: string, state: PinState | 'detour' | 'crew' | 'home', selected = false) => L.divIcon({
  html: `<span class="tc-tmap__pin${selected ? ' is-selected' : ''}" data-state="${state}">${clean(text)}</span>`,
  className: '', iconSize: state === 'now' ? [34, 34] : [28, 28], iconAnchor: state === 'now' ? [17, 17] : [14, 14],
});


const Fit: React.FC<{ points: [number, number][]; focus: [number, number] | null }> = ({ points, focus }) => {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    const t = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0]!, 15);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    }, 50);
    return () => window.clearTimeout(t);
    // 点の並びが変わった時だけ合わせ直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  useEffect(() => {
    if (focus) map.panTo(focus);
  }, [map, focus]);
  return null;
};

const TodayMap: React.FC<{
  ctx: TodayCtx;
  variant?: 'card' | 'full' | 'route';
  filters?: MapFilters;
  selectedId?: string | null;
  onSelect?: (eventId: string) => void;
  crew?: EtaShare[];
  pale?: boolean;
  me?: [number, number] | null;
  /** route の時の点(順に結ぶ) */
  route?: { lat: number; lng: number; label: string; state: PinState | 'home' }[];
}> = ({ ctx, variant = 'card', filters = ALL_FILTERS, selectedId = null, onSelect, crew = [], pale = false, me = null, route }) => {
  const { events, timeZone, nowEv, nextEv, doneIds, visitedIds, rainIds, detourPins } = ctx;
  const placed = useMemo(() => events.map((e, i) => ({ e, i }))
    .filter(({ e }) => e.latitude != null && e.longitude != null), [events]);
  const detours = useMemo(() => (filters.detour ? detourPins.filter((d) => d.latitude != null && d.longitude != null) : []),
    [filters.detour, detourPins]);
  const points = useMemo(() => {
    if (route) return route.map((r) => [r.lat, r.lng] as [number, number]);
    return [
      ...placed.map(({ e }) => [e.latitude!, e.longitude!] as [number, number]),
      ...detours.map((d) => [d.latitude!, d.longitude!] as [number, number]),
    ];
  }, [placed, detours, route]);
  if (points.length === 0) return null;
  const nowId = nowEv?.id ?? null;
  const nextId = nextEv?.id ?? null;
  const stateOf = (id: string): PinState => id === nowId ? 'now' : id === nextId ? 'next'
    : visitedIds.has(id) || doneIds.has(id) ? 'done' : rainIds.has(id) ? 'rain' : 'todo';
  const pastIdx = placed.findIndex(({ e }) => !(doneIds.has(e.id) || visitedIds.has(e.id) || e.id === nowId));
  const cut = pastIdx === -1 ? placed.length : pastIdx;
  const useTrail = ctx.settings.location.trail && ctx.trail.length > 1;
  const walked = useTrail ? ctx.trail.map((p) => [p[0], p[1]] as [number, number])
    : placed.slice(0, Math.max(cut, 0)).map(({ e }) => [e.latitude!, e.longitude!] as [number, number]);
  const ahead = placed.slice(Math.max(cut - 1, 0)).map(({ e }) => [e.latitude!, e.longitude!] as [number, number]);
  const sel = selectedId ? placed.find(({ e }) => e.id === selectedId) : null;
  const focus: [number, number] | null = variant === 'full' && sel ? [sel.e.latitude!, sel.e.longitude!] : null;
  const interactive = variant !== 'card';
  return (
    <MapContainer center={points[0]!} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom={variant === 'full'}
      zoomControl={false} attributionControl className={pale ? 'tl-map-pale' : undefined}>
      {interactive && <ZoomControl position="bottomright" />}
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit points={points} focus={focus} />
      {route ? (
        <>
          <Polyline positions={route.map((r) => [r.lat, r.lng] as [number, number])} pathOptions={{ color: '#0f6e66', weight: 5, dashArray: '8 8' }} />
          {route.map((r, i) => (
            <Marker key={`r-${i}`} position={[r.lat, r.lng]} icon={icon(r.label, r.state)} title={r.label} />
          ))}
        </>
      ) : (
        <>
          {filters.trail && walked.length > 1 && <Polyline positions={walked} pathOptions={{ color: '#b23c22', weight: 5, opacity: 0.9 }} />}
          {filters.plan && ahead.length > 1 && <Polyline positions={ahead} pathOptions={{ color: '#0f6e66', weight: 4, dashArray: '8 8' }} />}
          {filters.plan && placed.map(({ e, i }) => {
            let st = stateOf(e.id);
            if (st === 'rain' && !filters.rain) st = 'todo';
            const text = st === 'now' ? 'NOW' : st === 'done' ? sealGlyph(e.title, e.event_type).slice(0, 1)
              : /accommodation|lodging/.test(e.event_type) ? '宿' : String(i + 1);
            const word = { now: '今いる場所', next: '次の場所', done: '済', rain: '雨の時間', todo: 'この後' }[st];
            return (
              <Marker key={e.id} position={[e.latitude!, e.longitude!]} icon={icon(text, st, e.id === selectedId)}
                eventHandlers={{ click: () => onSelect?.(e.id) }} title={`${e.title}(${word})`} keyboard={interactive}>
                <Tooltip direction="top" offset={[0, -14]}>{`${formatTimeInZone(e.start_at, timeZone)} ${e.title}(${word})`}</Tooltip>
              </Marker>
            );
          })}
          {detours.map((d, i) => (
            <Marker key={`d-${d.name}-${i}`} position={[d.latitude!, d.longitude!]} icon={icon(String.fromCharCode(65 + i), 'detour')}
              title={`寄り道の候補 ${d.name}`}>
              <Tooltip direction="top" offset={[0, -14]}>{`寄り道 ${d.name}`}</Tooltip>
            </Marker>
          ))}
          {filters.crew && crew.filter((c) => !c.is_self).map((c) => {
            const ev = placed.find(({ e }) => e.id === c.event_id);
            if (!ev) return null;
            return (
              <Marker key={`c-${c.user_id}`} position={[ev.e.latitude! + 0.0004, ev.e.longitude! + 0.0004]}
                icon={icon([...c.label][0] ?? '?', 'crew')} title={`${c.label} ${formatTimeInZone(c.arrive_at, timeZone)} 着予定`}>
                <Tooltip direction="right" offset={[12, 0]}>{`${c.label} ${formatTimeInZone(c.arrive_at, timeZone)} 着予定`}</Tooltip>
              </Marker>
            );
          })}
        </>
      )}
      {me && <CircleMarker center={me} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }} />}
    </MapContainer>
  );
};

export default TodayMap;
