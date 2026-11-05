/**
 * [Gate BookletPatterns] しおりの地図。印刷でも崩れないよう、地図の画像を決まった大きさで並べ、線とピンを SVG で重ねる。
 * 画像を読めない時(オフライン・配信元の不調)も、ピンと線だけで位置の関係が分かる。OpenStreetMap の表示は印刷にも残す。
 */
import React, { useMemo } from 'react';
import type { BookletPoint } from '@/services/api';

const TILE = 256;
const W = 720;
const PAD = 46;

interface Props {
  points: BookletPoint[];
  /** 日ごとの順路(ピンの番号の並び) */
  routes: { color: number; nos: number[] }[];
  /** ピンの色の番号。無ければ 0 */
  colorOf?: (p: BookletPoint) => number;
  height?: number;
  label: string;
}

const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

function fitView(points: { latitude: number; longitude: number }[], h: number) {
  let zoom = 15;
  for (; zoom > 1; zoom -= 1) {
    const xs = points.map((p) => worldX(p.longitude, zoom));
    const ys = points.map((p) => worldY(p.latitude, zoom));
    if (Math.max(...xs) - Math.min(...xs) <= W - PAD * 2 && Math.max(...ys) - Math.min(...ys) <= h - PAD * 2) break;
  }
  const xs = points.map((p) => worldX(p.longitude, zoom));
  const ys = points.map((p) => worldY(p.latitude, zoom));
  return { zoom, left: (Math.min(...xs) + Math.max(...xs)) / 2 - W / 2, top: (Math.min(...ys) + Math.max(...ys)) / 2 - h / 2 };
}

const BookletMap: React.FC<Props> = ({ points, routes, colorOf, height = 420, label }) => {
  const view = useMemo(() => fitView(points, height), [points, height]);
  const tiles = useMemo(() => {
    const out: { key: string; src: string; x: number; y: number }[] = [];
    const max = 2 ** view.zoom;
    for (let tx = Math.floor(view.left / TILE); tx * TILE < view.left + W; tx += 1) {
      for (let ty = Math.floor(view.top / TILE); ty * TILE < view.top + height; ty += 1) {
        if (ty >= 0 && ty < max) {
          const wrap = ((tx % max) + max) % max;
          out.push({ key: `${tx}/${ty}`, x: tx * TILE - view.left, y: ty * TILE - view.top,
            src: `https://${'abc'[Math.abs(tx + ty) % 3]}.tile.openstreetmap.org/${view.zoom}/${wrap}/${ty}.png` });
        }
      }
    }
    return out;
  }, [view, height]);
  // 重なるピンは少しずらす(番号を読めるように)
  const placed = useMemo(() => {
    const out = new Map<number, { x: number; y: number }>();
    for (const p of points) {
      let x = worldX(p.longitude, view.zoom) - view.left;
      let y = worldY(p.latitude, view.zoom) - view.top;
      for (let i = 0; i < 12 && [...out.values()].some((o) => Math.hypot(o.x - x, o.y - y) < 24); i += 1) {
        x += Math.cos(i * 2.4) * 16;
        y += Math.sin(i * 2.4) * 16;
      }
      out.set(p.no, { x, y });
    }
    return out;
  }, [points, view]);
  return (
    <figure className="bk-map">
      <div className="bk-map-frame" style={{ aspectRatio: `${W} / ${height}` }} role="img" aria-label={label}>
        <div className="bk-map-tiles">
          {tiles.map((t) => (
            <img key={t.key} src={t.src} alt="" loading="eager" referrerPolicy="strict-origin-when-cross-origin"
              style={{ left: `${(t.x / W) * 100}%`, top: `${(t.y / height) * 100}%`, width: `${(TILE / W) * 100}%`, height: `${(TILE / height) * 100}%` }}
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${height}`} aria-hidden="true">
          {routes.map((r, i) => {
            const line = r.nos.map((n) => placed.get(n)).filter((o): o is { x: number; y: number } => !!o);
            if (line.length < 2) return null;
            const d = line.map((o) => `${o.x.toFixed(1)},${o.y.toFixed(1)}`).join(' ');
            return (
              <g key={i}>
                <polyline points={d} fill="none" stroke="#fff" strokeWidth="6" strokeLinejoin="round" opacity="0.85" />
                <polyline points={d} fill="none" style={{ stroke: `var(--bk-d${r.color % 6})` }} strokeWidth="3" strokeLinejoin="round" />
              </g>
            );
          })}
          {points.map((p) => {
            const o = placed.get(p.no);
            return o ? (
              <g key={p.no} transform={`translate(${o.x.toFixed(1)} ${o.y.toFixed(1)})`}>
                <circle r="13" stroke="#fff" strokeWidth="2.5" style={{ fill: `var(--bk-d${(colorOf?.(p) ?? 0) % 6})` }} />
                <text y="4.5" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700" fontFamily="sans-serif">{p.no}</text>
              </g>
            ) : null;
          })}
        </svg>
      </div>
      <figcaption className="bk-map-credit">
        地図 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
      </figcaption>
    </figure>
  );
};

export default BookletMap;
