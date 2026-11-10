/**
 * [Gate DiscoverUX] 発見の地図(検索結果・この旅行の候補)。OpenStreetMap のタイル(キー不要。旅程の地図と同じ提供元)。
 * 探す基点と場所の印を置き、基点から各場所へ直線を引いて「直線距離の目安」を出す(道の距離・所要時間ではない)。
 */
import React, { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // 地図の画像・印の位置を決める CSS
import { kmLabel, straightKm, type BasePoint, type DiscoverPin } from './discoverModel';

interface Props {
  base: BasePoint | null;
  pins: DiscoverPin[];
  /** 印を押した時(一覧のカードへ移る など) */
  onPick?: (id: string) => void;
  height?: number;
  label: string;
}

const KIND_TEXT: Record<DiscoverPin['kind'], string> = { result: '未保存', saved: '候補', scheduled: '日程に配置済み' };

function pinIcon(kind: DiscoverPin['kind'], n: number) {
  return L.divIcon({
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div class="tc-disc-pin" data-kind="${kind}">${n}</div>`,
  });
}
const baseIcon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="tc-disc-pin tc-disc-pin--base">基</div>' });

const Fit: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0]!, 14);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(map.getContainer());
    return () => ro?.disconnect();
  }, [map, points]);
  return null;
};

const DiscoverMap: React.FC<Props> = ({ base, pins, onPick, height = 380, label }) => {
  const points = useMemo<[number, number][]>(() => [
    ...(base ? [[base.latitude, base.longitude] as [number, number]] : []),
    ...pins.map((p) => [p.latitude, p.longitude] as [number, number]),
  ], [base, pins]);
  if (points.length === 0) {
    return <p className="tc-card tc-kit-empty" data-testid="discover-map-empty">地図の位置が分かる場所がありません。</p>;
  }
  return (
    <figure className="m-0" data-testid="discover-map">
      <div className="overflow-hidden rounded-xl border border-cloud-200" style={{ height }} role="region" aria-label={label}>
        <MapContainer center={points[0]!} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Fit points={points} />
          {base && (
            <Marker position={[base.latitude, base.longitude]} icon={baseIcon}>
              <Tooltip direction="top" offset={[0, -12]}>{`探す基点: ${base.label}`}</Tooltip>
            </Marker>
          )}
          {pins.map((p, i) => {
            const km = base ? straightKm(base, p) : null;
            return (
              <React.Fragment key={p.id}>
                {base && (
                  <Polyline positions={[[base.latitude, base.longitude], [p.latitude, p.longitude]]}
                    pathOptions={{ color: '#0b766e', weight: 2, opacity: 0.55, dashArray: '4 6' }} />
                )}
                <Marker position={[p.latitude, p.longitude]} icon={pinIcon(p.kind, i + 1)}
                  eventHandlers={onPick ? { click: () => onPick(p.id) } : undefined}>
                  <Tooltip direction="top" offset={[0, -12]}>
                    {`${i + 1}. ${p.label}(${KIND_TEXT[p.kind]})${km !== null ? ` · 直線 ${kmLabel(km)}` : ''}`}
                  </Tooltip>
                </Marker>
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-700">
        <span><span className="tc-disc-key tc-disc-pin--base" aria-hidden="true" /> 探す基点</span>
        <span><span className="tc-disc-key" data-kind="result" aria-hidden="true" /> 未保存の検索結果</span>
        <span><span className="tc-disc-key" data-kind="saved" aria-hidden="true" /> この旅行の候補</span>
        <span><span className="tc-disc-key" data-kind="scheduled" aria-hidden="true" /> 日程に配置済み</span>
        <span>点線は基点からの直線(道の距離ではありません)</span>
      </figcaption>
    </figure>
  );
};

export default DiscoverMap;
