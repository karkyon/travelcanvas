/**
 * [Gate PhotoMap・PhotoPlace] 旅の記録の地図モード(DOC-14 §4.5 MEMORY MAP、提案 SC-53)。
 * 地図の部品は重いので、この画面を開いた時だけ読み込む(MemoriesPage の React.lazy)。
 * 確定は写真の印、推定は破線と「?」の印で分ける(色だけで区別しない)。地図を使わず一覧と予定の選択でも同じ操作ができる。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { changeMemoryLocation, getMemoryMap, getMemoryThumbnail } from '@/services/api/photoFeatures';
import type { LocationChange, MapPhoto, MemoryMap } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { clusterPoints } from './clusterModel';

export interface PlaceOption { id: string; label: string; latitude: number; longitude: number; name: string }

const SOURCE_LABEL: Record<string, string> = {
  exif: '写真の撮影位置', track: '位置の記録から推定', event: '予定の時刻から推定', manual: '本人が指定',
};

const confidenceLabel = (value: number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return value >= 0.8 ? '高' : '要確認';
};

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const pinIcon = (photo: MapPhoto, thumb: string | undefined, selected: boolean) => {
  const proposed = photo.location_status === 'proposed';
  const border = selected ? '3px solid var(--tc-focus)' : proposed ? '3px dashed var(--tc-warning)' : '3px solid var(--tc-cloud-0)';
  const image = thumb ? `background-image:url(&quot;${escapeAttr(thumb)}&quot;);background-size:cover;` : 'background:var(--tc-accent);';
  return L.divIcon({
    className: '', iconSize: [44, 44], iconAnchor: [22, 22],
    html: `<div style="width:44px;height:44px;border-radius:8px;box-shadow:0 1px 5px #0006;border:${border};${image}display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;text-shadow:0 1px 3px #000">${proposed ? '?' : ''}</div>`,
  });
};

const Fit: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0]!, 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
  }, [map, points]);
  return null;
};

const clusterIcon = (count: number) => L.divIcon({
  className: '', iconSize: [44, 44], iconAnchor: [22, 22],
  html: `<div style="width:44px;height:44px;border-radius:50%;background:var(--tc-accent);color:#fff;border:3px solid var(--tc-cloud-0);box-shadow:0 1px 5px #0006;display:flex;align-items:center;justify-content:center;font-weight:800">${count}</div>`,
});

/** [Gate Remaining-6] FR-037 近い写真の印を数の印にまとめる。押すとその範囲へ寄る。選んでいる写真はまとめない */
const PhotoMarkers: React.FC<{
  photos: MapPhoto[]; thumbs: Record<string, string>; selectedId: string | null; onSelect: (id: string) => void;
}> = ({ photos, thumbs, selectedId, onSelect }) => {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const groups = useMemo(() => {
    const pts = photos.filter((p) => p.id !== selectedId).map((p) => {
      const pt = map.project([p.latitude as number, p.longitude as number], zoom);
      return { id: p.id, x: pt.x, y: pt.y };
    });
    return clusterPoints(pts, 48);
  }, [photos, selectedId, map, zoom]);
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const one = (p: MapPhoto) => (
    <Marker key={p.id} position={[p.latitude as number, p.longitude as number]} icon={pinIcon(p, thumbs[p.id], p.id === selectedId)}
      title={p.place_name ?? '写真'} eventHandlers={{ click: () => onSelect(p.id) }} />
  );
  return (
    <>
      {groups.map((g) => {
        if (g.ids.length === 1) return one(byId.get(g.ids[0]!)!);
        const members = g.ids.map((id) => byId.get(id)!);
        const pos = map.unproject([g.x, g.y], zoom);
        return (
          <Marker key={`c-${g.ids.join('-')}`} position={pos} icon={clusterIcon(g.ids.length)} title={`写真 ${g.ids.length} 枚`}
            eventHandlers={{ click: () => map.fitBounds(L.latLngBounds(members.map((m) => [m.latitude as number, m.longitude as number])), { padding: [60, 60], maxZoom: 18 }) }} />
        );
      })}
      {photos.filter((p) => p.id === selectedId).map(one)}
    </>
  );
};

const ClickToPlace: React.FC<{ active: boolean; onPlace: (lat: number, lng: number) => void }> = ({ active, onPlace }) => {
  useMapEvents({ click: (e) => { if (active) onPlace(e.latlng.lat, e.latlng.lng); } });
  return null;
};

const MemoryMapPanel: React.FC<{ planId: string; places: PlaceOption[]; refreshKey?: number }> = ({ planId, places, refreshKey }) => {
  const [data, setData] = useState<MemoryMap | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await getMemoryMap(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '写真の地図を読み込めませんでした'));
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const all = useMemo(() => [...(data?.photos ?? []), ...(data?.unplaced ?? [])], [data]);
  useEffect(() => {
    let active = true;
    // 同時に開きすぎないよう 1 枚ずつ読む(縮小版はサーバーがその都度作る)
    void (async () => {
      for (const p of all) {
        if (!active || thumbs[p.id]) continue;
        try {
          const blob = await getMemoryThumbnail(planId, p.id);
          if (!active) return;
          const u = URL.createObjectURL(blob);
          urls.current.push(u);
          setThumbs((prev) => ({ ...prev, [p.id]: u }));
        } catch { /* 縮小版が無くても位置の操作はできる */ }
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- thumbs を入れると読み直しが連鎖する
  }, [all, planId]);

  const selected = all.find((p) => p.id === selectedId) ?? null;
  const change = async (photo: MapPhoto, body: LocationChange) => {
    setError(null);
    try {
      await changeMemoryLocation(planId, photo.id, body, photo.revision);
      setPlacing(false);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '位置を変更できませんでした'));
      await load();
    }
  };
  const points = (data?.photos ?? []).map((p) => [p.latitude as number, p.longitude as number] as [number, number]);
  const review = all.filter((p) => p.by_me && p.location_status !== 'confirmed');
  const center: [number, number] = points[0] ?? (places[0] ? [places[0].latitude, places[0].longitude] : [36.2, 138.25]);

  if (!data && !error) return <p role="status" className="tc-card p-4 text-sm text-ink-700">写真の地図を読み込み中…</p>;
  return (
    <section className="tc-card p-4 space-y-3" aria-labelledby="memory-map-title" data-testid="memory-map">
      <h2 id="memory-map-title" className="tc-section-title">写真の地図</h2>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {placing && <p role="status" className="text-sm text-info">地図の置きたい場所を押してください</p>}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div style={{ height: 420, borderRadius: 12, overflow: 'hidden', cursor: placing ? 'crosshair' : undefined }}>
            <MapContainer center={center} zoom={points.length ? 13 : 6} style={{ height: '100%', width: '100%' }}>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Fit points={points} />
              <ClickToPlace active={placing && !!selected} onPlace={(lat, lng) => { if (selected) void change(selected, { action: 'set', latitude: lat, longitude: lng }); }} />
              <PhotoMarkers photos={data?.photos ?? []} thumbs={thumbs} selectedId={selectedId}
                onSelect={(id) => { setSelectedId(id); setPlacing(false); }} />
            </MapContainer>
          </div>
          <p className="mt-1 text-xs text-ink-700">枠線が破線で「?」の写真は推定の位置です。確定するまで他の人には見えません。丸に数字の印は近くの写真のまとまり(押すと寄ります)。</p>
        </div>
        <div className="space-y-3 min-w-0">
          <p className="text-sm"><b>{`確認が必要 ${review.length} 枚`}</b>{` / 全 ${all.length} 枚`}</p>
          {all.length === 0 && <p className="text-sm text-ink-700">写真がまだありません。「スマホから写真を送る」か「写真・メモを追加」から追加できます。</p>}
          <ul className="space-y-1 max-h-60 overflow-auto" aria-label="写真の一覧">
            {all.map((p) => (
              <li key={p.id}>
                <button type="button" aria-pressed={p.id === selectedId} onClick={() => { setSelectedId(p.id); setPlacing(false); }}
                  className={`tc-focus-ring w-full flex items-center gap-2 rounded-lg p-1 text-left text-sm ${p.id === selectedId ? 'bg-accent-soft' : ''}`}>
                  {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" width={36} height={36} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ width: 36, height: 36 }} className="rounded-md bg-cloud-100" />}
                  <span className="min-w-0 flex-1 truncate">{p.place_name ?? (p.occurred_at ? new Date(p.occurred_at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '日時なし')}</span>
                  <span className={`tc-pill ${p.location_status === 'confirmed' ? 'tc-pill--good' : ''}`}>
                    {p.location_status === 'confirmed' || (p.latitude !== null && !p.location_status) ? '確定' : p.location_status === 'proposed' ? '推定' : '未配置'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="border-t pt-2 space-y-2 text-sm" data-testid="memory-map-detail">
              {selected.location_source
                ? <p>{`根拠: ${SOURCE_LABEL[selected.location_source] ?? ''}`}{confidenceLabel(selected.location_confidence) ? ` ・ 信頼度 ${confidenceLabel(selected.location_confidence)}` : ''}</p>
                : <p>{selected.latitude === null ? '位置がありません。地図か予定から選んでください。' : '位置は登録済みです。'}</p>}
              {selected.by_me ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {selected.location_status === 'proposed' && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => void change(selected, { action: 'confirm' })}>この場所で確定</button>}
                    <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPlacing((v) => !v)}>{placing ? '置くのをやめる' : '地図で置く'}</button>
                    {selected.latitude !== null && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void change(selected, { action: 'clear' })}>位置を消す</button>}
                  </div>
                  <label className="block">予定の場所から選ぶ
                    <select className="block w-full mt-1 border rounded-sm px-2 py-1" value="" onChange={(e) => {
                      const place = places.find((x) => x.id === e.target.value);
                      if (place) void change(selected, { action: 'set', latitude: place.latitude, longitude: place.longitude, place_name: place.name, event_id: place.id });
                    }}>
                      <option value="">選んでください</option>
                      {places.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </label>
                  {selected.latitude !== null && selected.location_status !== 'proposed' && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.location_visibility === 'members'} onChange={(e) => void change(selected, { action: 'visibility', location_visibility: e.target.checked ? 'members' : 'private' })} />
                      写真を見られるメンバーに位置も見せる
                    </label>
                  )}
                </>
              ) : <p className="text-ink-700">{`${selected.author_name} さんの写真です。位置を変えられるのは本人だけです。`}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default MemoryMapPanel;
