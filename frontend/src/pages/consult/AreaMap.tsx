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

/** [Gate AreaGeo] 出発地と方面が地図いっぱいに入る範囲(近すぎる時は拡大しすぎない)。枠の大きさが変わったら合わせ直す */
const Fit: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0]!, 9);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 10 });
    };
    fit();
    const el = map.getContainer();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [map, points]);
  return null;
};

/** [Gate AreaMapFocus] 一覧で選んだ方面へ地図を寄せる(拡大の度合いは変えない。画面の外にある時だけ動かす) */
const FocusSelected: React.FC<{ pin: AreaPin | undefined }> = ({ pin }) => {
  const map = useMap();
  useEffect(() => {
    if (!pin) return;
    const at = L.latLng(pin.latitude, pin.longitude);
    if (!map.getBounds().pad(-0.1).contains(at)) map.panTo(at, { animate: true });
  }, [map, pin]);
  return null;
};

/** 選んだ方面の印(大きく・名前つき・波紋のアニメーション)。動きを減らす設定では波紋を止める(CSS) */
function selectedIcon(p: AreaPin) {
  return L.divIcon({
    className: '', iconSize: [48, 48], iconAnchor: [24, 24],
    html: `<div class="tc-pin-selected" data-testid="area-pin-selected"><span class="tc-pin-pulse"></span><span class="tc-pin-pulse tc-pin-pulse--late"></span>`
      + `<div class="tc-pin-core">${p.order}</div></div>`,
  });
}

/**
 * [Gate AreaMapA11y] 吹き出しの文字は Leaflet が吹き出しの枠を作る時に渡す。react-leaflet の子要素で渡すと、枠
 * (role="tooltip")が一瞬だけ空のまま出て、読み上げの名前が無い吹き出しになっていた(CI の axe aria-tooltip-name が
 * 時々失敗)。文字は HTML ではなく文字の節点で渡す(方面・地名に記号があっても HTML として解釈しない)。
 * 文字が変わる時は Marker の key が変わり、作り直す。
 */
function textOf(text: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}

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
      <FocusSelected pin={pins.find((p) => p.selected)} />
      {origin && (
        <Marker key={`o-${origin.label}`} position={[origin.latitude, origin.longitude]} keyboard={false}
          icon={icon('<div style="width:22px;height:22px;border-radius:9999px;background:#c2410c;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', 22)}>
          <Tooltip permanent direction="top" offset={[0, -10]} content={textOf(`出発地: ${origin.label}`)} />
        </Marker>
      )}
      {origin && pins.map((p) => (
        <Polyline key={`l-${p.name}`} positions={[[origin.latitude, origin.longitude], [p.latitude, p.longitude]]}
          pathOptions={{ color: p.selected ? '#0f6e66' : '#94a3b8', weight: p.selected ? 5 : 2,
            dashArray: p.selected ? undefined : '6 6', opacity: p.selected ? 0.95 : 0.55 }} />
      ))}
      {pins.map((p) => (
        <Marker key={`${p.order}-${p.name}-${p.selected ? 's' : 'n'}`} position={[p.latitude, p.longitude]} keyboard={false}
          eventHandlers={{ click: () => onSelect(p.name) }} zIndexOffset={p.selected ? 1000 : 0}
          icon={p.selected ? selectedIcon(p) : icon(`<div style="display:grid;place-items:center;width:28px;height:28px;border-radius:9999px;background:#475569;color:#fff;font-weight:700;font-size:12px;border:2px solid #fff;opacity:.8;box-shadow:0 1px 3px rgba(0,0,0,.35)">${p.order}</div>`, 28)}>
          <Tooltip direction="top" offset={[0, p.selected ? -26 : -14]} permanent={p.selected}
            className={p.selected ? 'tc-pin-label' : undefined}
            content={textOf(p.selected ? `選択中: ${p.order}. ${p.name}` : `${p.order}. ${p.name}`)} />
        </Marker>
      ))}
    </MapContainer>
  );
};

export default AreaMap;
