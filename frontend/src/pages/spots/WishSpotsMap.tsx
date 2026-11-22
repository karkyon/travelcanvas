/**
 * [Gate WishMap] 行きたい場所の地図。OpenStreetMap のタイル(鍵は要らない。旅程の地図と同じ提供元)。
 *
 * - 絞り込んだ結果(種類・言葉)だけを、一覧と同じ番号の印で出す。絞り込みを変えると、出ている印が全部入る範囲に合わせる
 * - 選んだ場所は旅程と同じ形の赤い大きな印にし、その位置へ動かして、地図の上に詳しい内容(小窓)を出す
 * - 印を押すと、その場所を選ぶ(一覧のカードへ移る)
 * - 小窓の中から「旅行に追加」「編集」「Google マップ」「OpenStreetMap」へ進める
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink, MapPin, NotebookPen, Pencil, Plus } from 'lucide-react';
import { tripPinIcon } from '@/components/map/tripPins';
// [FR-062] 種類で印の形を変える(今度 ♡・また ★・エリア ◯。色だけに頼らない)
import { KIND_MARK, kindOf } from './wishKindModel';
import { safeExternalUrl } from '@/utils/safeNavigation';
import SpotLinks from '@/components/planner/SpotLinks';
import type { WishSpot } from '@/services/api/spotIntake';
import { googleMapsUrl, osmUrl, shortMemo, type WishPoint } from './wishMapModel';

interface Props {
  points: WishPoint<WishSpot>[];
  noLocation: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  categoryLabel: (s: WishSpot) => string;
  memoOf: (s: WishSpot) => string;
  onAddToTrip: (s: WishSpot) => void;
  onEdit: (s: WishSpot) => void;
  /** 絞り込みの条件が変わった印(範囲を合わせ直す) */
  filterKey: string;
}

/** 絞り込みが変わった時だけ、出ている印が全部入る範囲に合わせる(選んだ時は動かさない) */
const FitToPoints: React.FC<{ points: [number, number][]; filterKey: string }> = ({ points, filterKey }) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (points.length === 1) map.setView(points[0]!, 14);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 絞り込みの条件が変わった時だけ合わせる
  }, [map, filterKey, points.length]);
  useEffect(() => {
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(map.getContainer());
    return () => ro?.disconnect();
  }, [map]);
  return null;
};

/** 選んだ場所へ動かし、小窓を開く */
const FlyToSelected: React.FC<{ at: [number, number] | null; marker: L.Marker | null }> = ({ at, marker }) => {
  const map = useMap();
  useEffect(() => {
    if (!at) { map.closePopup(); return; }
    map.flyTo(at, Math.max(map.getZoom(), 14), { duration: 0.6 });
    const t = window.setTimeout(() => marker?.openPopup(), 650);
    return () => window.clearTimeout(t);
  }, [map, at, marker]);
  return null;
};

const WishSpotsMap: React.FC<Props> = ({ points, noLocation, selectedId, onSelect, categoryLabel, memoOf, onAddToTrip, onEdit, filterKey }) => {
  const refs = useRef<Map<string, L.Marker>>(new Map());
  const at = useMemo(() => points.map((p) => p.at), [points]);
  const selected = points.find((p) => p.spot.id === selectedId) ?? null;
  const [selMarker, setSelMarker] = React.useState<L.Marker | null>(null);
  useEffect(() => { setSelMarker(selectedId ? refs.current.get(selectedId) ?? null : null); }, [selectedId, points]);

  return (
    <figure className="tc-wishmap" data-testid="wish-map">
      <figcaption className="tc-wishmap__cap">
        <span><MapPin size={14} aria-hidden="true" />{`地図に ${points.length} か所`}</span>
        {noLocation > 0 && <span className="tc-muted">{`位置の無い場所 ${noLocation} か所は地図に出ません`}</span>}
      </figcaption>
      {points.length === 0 ? (
        <p className="tc-wishmap__empty" data-testid="wish-map-empty">絞り込んだ中に、地図の位置が分かる場所がありません。</p>
      ) : (
        <div className="tc-wishmap__box" role="region" aria-label="行きたい場所の地図">
          <MapContainer center={at[0]!} zoom={6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitToPoints points={at} filterKey={filterKey} />
            <FlyToSelected at={selected?.at ?? null} marker={selMarker} />
            {points.map((p) => {
              const sel = p.spot.id === selectedId;
              const memo = shortMemo(memoOf(p.spot));
              const google = googleMapsUrl(p.at[0], p.at[1]);
              const osm = osmUrl(p.at[0], p.at[1]);
              return (
                <Marker key={p.spot.id} position={p.at} icon={tripPinIcon(`${KIND_MARK[kindOf(p.spot)]}${p.no}`, { selected: sel, small: !sel && points.length > 60 })}
                  zIndexOffset={sel ? 1000 : 0} title={`${p.no}. ${p.spot.name}`}
                  ref={(m) => { if (m) refs.current.set(p.spot.id, m); else refs.current.delete(p.spot.id); }}
                  eventHandlers={{ click: () => onSelect(p.spot.id), popupclose: () => { if (sel) onSelect(null); } }}>
                  {!sel && <Tooltip className="tc-pin-tip" direction="top" offset={[0, -30]}>{`${p.no}. ${p.spot.name}`}</Tooltip>}
                  <Popup className="tc-wishpop" maxWidth={320} minWidth={240} autoPan>
                    <div className="tc-wishpop__in" data-testid={`wish-pop-${p.spot.id}`}>
                      <p className="tc-wishpop__kind"><span className="tc-wishpop__no">{p.no}</span>{categoryLabel(p.spot)}</p>
                      <h3>{p.spot.name}</h3>
                      <p className="tc-wishpop__row"><MapPin size={13} aria-hidden="true" />{p.spot.address || '住所は未入力'}</p>
                      {memo && <p className="tc-wishpop__row"><NotebookPen size={13} aria-hidden="true" /><span>{memo}</span></p>}
                      <SpotLinks phone={p.spot.phone} urls={p.spot.urls} className="tc-spot-links--start" />
                      <div className="tc-wishpop__acts">
                        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => onAddToTrip(p.spot)}>
                          <Plus size={13} aria-hidden="true" />旅行に追加
                        </button>
                        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onEdit(p.spot)}>
                          <Pencil size={13} aria-hidden="true" />編集
                        </button>
                      </div>
                      <p className="tc-wishpop__links">
                        {google && <a href={safeExternalUrl(google) ?? undefined} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} aria-hidden="true" />Google マップ</a>}
                        {osm && <a href={safeExternalUrl(osm) ?? undefined} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} aria-hidden="true" />OpenStreetMap</a>}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      )}
    </figure>
  );
};

export default WishSpotsMap;
