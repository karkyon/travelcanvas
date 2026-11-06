/**
 * [Gate Footprints2] 旅の足あとの地図(日本 / 世界)。
 *
 * - 日本: 47 都道府県を角の丸い升目にして、おおよその位置に並べた略図(地方ごとに色分け)。行った県は濃い色、計画中は点線の枠。
 *   升目の並びはこの画面のために作った独自の配置(市販の地図の素材は使っていない)。
 * - 世界: 陸を経度・緯度 3° の升目にした略図(worldGrid.ts。地域ごとに色分け)。行った・計画中の旅の予定の位置を点で示す。
 * 地図は飾りの絵(role="img")で、内容は名前(aria-label)と下の数で伝える。外から地図の画像・データを読まない。
 */
import React from 'react';
import { WORLD_ROWS, WORLD_STEP } from './worldGrid';
import { AREA_COLOR, AREA_LABEL, C, PREF_TILES, REGION_COLOR, REGION_LABEL, onColor, project, type MapPoint, type Region } from './footprintModel';

export type { MapPoint } from './footprintModel';

// ------------------------------------------------------------------ 日本

const U = 40; // 升目 1 つの大きさ(viewBox の単位)
const PAD = 3;

export const JapanTileMap: React.FC<{ visited: ReadonlySet<string>; planned: ReadonlySet<string> }> = ({ visited, planned }) => {
  const label = `日本の地図。行った都道府県: ${[...visited].join('、') || 'まだありません'}。計画中: ${[...planned].filter((p) => !visited.has(p)).join('、') || 'なし'}`;
  return (
    <svg viewBox={`0 0 ${13 * U} ${13 * U}`} className="tc-fp-map tc-fp-japan" role="img" aria-label={label} data-testid="footprint-japan">
      {PREF_TILES.map(([name, region, x, y, w, h]) => {
        const state = visited.has(name) ? 'visited' : planned.has(name) ? 'planned' : 'none';
        const color = REGION_COLOR[region];
        const short = name === '北海道' ? '北海道' : name.replace(/[都府県]$/, '');
        return (
          <g key={name} data-pref={name} data-state={state} data-region={region}>
            <title>{`${name}${state === 'visited' ? '(行った)' : state === 'planned' ? '(計画中)' : ''}`}</title>
            <rect x={x * U + PAD} y={y * U + PAD} width={w * U - PAD * 2} height={h * U - PAD * 2} rx={7}
              fill={color} fillOpacity={state === 'visited' ? 1 : 0.2}
              stroke={state === 'planned' ? color : 'none'} strokeWidth={state === 'planned' ? 2.5 : 0}
              strokeDasharray={state === 'planned' ? '5 3' : undefined} />
            <text x={(x + w / 2) * U} y={(y + h / 2) * U} textAnchor="middle" dominantBaseline="central"
              fontSize={short.length >= 3 ? 10.5 : 12} fontWeight={state === 'none' ? 500 : 800}
              fill={state === 'visited' ? onColor(color) : 'var(--tc-ink-900)'}>{short}</text>
          </g>
        );
      })}
    </svg>
  );
};

/** 地方の色の見本(凡例) */
export const RegionLegend: React.FC = () => (
  <ul className="tc-fp-regions" aria-label="地方の色">
    {(Object.keys(REGION_COLOR) as Region[]).map((r) => (
      <li key={r}><span style={{ background: REGION_COLOR[r] }} aria-hidden="true" />{REGION_LABEL[r]}</li>
    ))}
  </ul>
);

// ------------------------------------------------------------------ 世界

export const WorldTileMap: React.FC<{ points: MapPoint[] }> = ({ points }) => {
  const width = (360 / WORLD_STEP) * C;
  const height = WORLD_ROWS.length * C;
  const visited = points.filter((p) => p.state === 'visited');
  const planned = points.filter((p) => p.state === 'planned');
  const label = `世界の地図。行った場所 ${visited.length} か所、計画中 ${planned.length} か所`
    + (points.length ? `(${[...new Set(points.map((p) => p.label.split('・')[0]))].slice(0, 8).join('、')})` : '');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="tc-fp-map tc-fp-world" role="img" aria-label={label} data-testid="footprint-world">
      <g aria-hidden="true">
        {WORLD_ROWS.map((row, r) => Array.from(row).map((ch, c) => (ch === '.' ? null : (
          <rect key={`${r}-${c}`} x={c * C + 0.5} y={r * C + 0.5} width={C - 1} height={C - 1} rx={1.4}
            fill={AREA_COLOR[ch] ?? '#94a3b8'} fillOpacity={ch === 'J' ? 0.55 : 0.32} />
        ))))}
      </g>
      {/* 計画中は白抜き、行った場所は塗りの点(行った方を上に描く) */}
      {[...planned, ...visited].map((p, i) => {
        const { x, y } = project(p.lat, p.lng);
        return (
          <g key={`${p.state}-${i}`} data-state={p.state} className="tc-fp-dot">
            <title>{`${p.label}(${p.state === 'visited' ? '行った' : '計画中'})`}</title>
            <circle cx={x} cy={y} r={p.state === 'visited' ? 7.5 : 7}
              fill={p.state === 'visited' ? 'var(--tc-accent)' : 'var(--tc-cloud-0)'}
              stroke={p.state === 'visited' ? 'var(--tc-cloud-0)' : 'var(--tc-accent)'} strokeWidth={p.state === 'visited' ? 2.2 : 2.8} />
          </g>
        );
      })}
    </svg>
  );
};

export const AreaLegend: React.FC = () => (
  <ul className="tc-fp-regions" aria-label="地域の色">
    {['A', 'J', 'E', 'N', 'S', 'F', 'O'].map((k) => (
      <li key={k}><span style={{ background: AREA_COLOR[k] }} aria-hidden="true" />{AREA_LABEL[k]}</li>
    ))}
  </ul>
);
