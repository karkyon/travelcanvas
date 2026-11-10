/**
 * [Gate Footprints2] 旅の足あとの地図(日本 / 世界)。
 *
 * - 日本: 47 都道府県を角の丸い升目にして、おおよその位置に並べた略図(地方ごとに色分け)。行った県は濃い色、計画中は点線の枠。
 *   升目の並びはこの画面のために作った独自の配置(市販の地図の素材は使っていない)。
 * - 世界: 陸を経度・緯度 3° の升目にした略図(worldGrid.ts。地域ごとに色分け)。行った・計画中の旅の予定の位置を点で示す。
 * 地図は飾りの絵(role="img")で、内容は名前(aria-label)と下の数で伝える。外から地図の画像・データを読まない。
 *
 * [Gate FootHover] カーソルを当てた県(升目)を山のように 2 段階で浮かせる(当てた所を高く、周りを低く)。
 * その場所に旅行があれば、題名と期間をポップアップで出す(直近 5 件。題名を押すとその旅行を開く)。
 * 別の県・升目へ移るたびに短い「カタカタ」という音を鳴らす(footSound。鳴らさない設定もできる)。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FootTrip } from '@/services/api/types/g9';
import { WORLD_ROWS, WORLD_STEP } from './worldGrid';
import {
  AREA_COLOR, AREA_LABEL, C, PREF_TILES, REGION_COLOR, REGION_LABEL, footPeriod, neighborPrefs, onColor, project,
  recentFootTrips, tripsNearCell, type MapPoint, type Region,
} from './footprintModel';
import { tick, unlockSound } from './footSound';

export type { MapPoint } from './footprintModel';

// ------------------------------------------------------------------ 共通: ポップアップ

// x は横の中心、top・bottom は場所の上端・下端(地図の幅・高さに対する割合 0〜1)
interface PopupAt { title: string; trips: FootTrip[]; x: number; top: number; bottom: number }

const FootPopup: React.FC<{ at: PopupAt }> = ({ at }) => {
  const below = at.top < 0.32; // 上の方では下に出す(地図の外にはみ出さない)
  const align = at.x < 0.22 ? 'start' : at.x > 0.78 ? 'end' : 'center';
  return (
    <div className="tc-fp-pop" data-below={below} data-align={align} role="dialog" aria-label={`${at.title}の旅行`}
      style={{ left: `${at.x * 100}%`, top: `${(below ? at.bottom : at.top) * 100}%` }} data-testid="footprint-popup">
      <p className="tc-fp-pop-title">{at.title}</p>
      <ul>
        {at.trips.map((t) => (
          <li key={t.plan_id}>
            <Link to={`/planner/${t.plan_id}`} className="tc-focus-ring" data-testid="footprint-popup-trip">
              <b>{t.title}</b>
              <small>{footPeriod(t)}{t.state === 'planned' ? '・計画中' : ''}</small>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** ポップアップを出す場所(地図の枠)。外を押す・枠から出るとしばらくして閉じる */
function useHover<T>() {
  const [hover, setHover] = useState<T | null>(null);
  const timer = useRef<number | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const cancel = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const leave = useCallback(() => { cancel(); timer.current = window.setTimeout(() => setHover(null), 220); }, []);
  useEffect(() => {
    if (hover === null) return undefined;
    const outside = (e: PointerEvent) => { if (frame.current && !frame.current.contains(e.target as Node)) setHover(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [hover]);
  useEffect(() => () => cancel(), []);
  return { hover, setHover: (v: T | null) => { cancel(); setHover(v); }, leave, frame };
}

// ------------------------------------------------------------------ 日本

const U = 40; // 升目 1 つの大きさ(viewBox の単位)
const PAD = 3;
const SIZE = 13 * U;

export const JapanTileMap: React.FC<{
  visited: ReadonlySet<string>; planned: ReadonlySet<string>; prefTrips?: Record<string, FootTrip[]>;
}> = ({ visited, planned, prefTrips }) => {
  const label = `日本の地図。行った都道府県: ${[...visited].join('、') || 'まだありません'}。計画中: ${[...planned].filter((p) => !visited.has(p)).join('、') || 'なし'}`;
  const { hover, setHover, leave, frame } = useHover<string>();
  const near = useMemo(() => (hover ? neighborPrefs(hover) : new Set<string>()), [hover]);
  const enter = (name: string) => { if (name !== hover) { tick(true); setHover(name); } };
  // 浮かせる県は後に描く(上に重ねる): 普通 → 周り → 当てた県
  const order = useMemo(() => {
    const rank = (n: string) => (n === hover ? 2 : near.has(n) ? 1 : 0);
    return [...PREF_TILES].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [hover, near]);
  const tile = hover ? PREF_TILES.find((t) => t[0] === hover) : undefined;
  const trips = hover ? recentFootTrips(prefTrips?.[hover] ?? []) : [];
  const pop: PopupAt | null = tile && trips.length
    ? { title: hover!, trips, x: (tile[2] + tile[4] / 2) / 13, top: tile[3] / 13, bottom: (tile[3] + tile[5]) / 13 }
    : null;
  return (
    <div className="tc-fp-stage" ref={frame} onPointerLeave={leave} onPointerDown={unlockSound}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="tc-fp-map tc-fp-japan" role="img" aria-label={label} data-testid="footprint-japan">
        {order.map(([name, region, x, y, w, h]) => {
          const state = visited.has(name) ? 'visited' : planned.has(name) ? 'planned' : 'none';
          const color = REGION_COLOR[region];
          const short = name === '北海道' ? '北海道' : name.replace(/[都府県]$/, '');
          const lift = name === hover ? 2 : near.has(name) ? 1 : 0;
          return (
            <g key={name} data-pref={name} data-state={state} data-region={region} data-lift={lift} className="tc-fp-tile"
              onPointerEnter={() => enter(name)} onClick={() => enter(name)}>
              <title>{`${name}${state === 'visited' ? '(行った)' : state === 'planned' ? '(計画中)' : ''}`}</title>
              <rect x={x * U + PAD} y={y * U + PAD} width={w * U - PAD * 2} height={h * U - PAD * 2} rx={7}
                fill={color} fillOpacity={state === 'visited' ? 1 : lift ? 0.42 : 0.2}
                stroke={state === 'planned' ? color : 'none'} strokeWidth={state === 'planned' ? 2.5 : 0}
                strokeDasharray={state === 'planned' ? '5 3' : undefined} />
              <text x={(x + w / 2) * U} y={(y + h / 2) * U} textAnchor="middle" dominantBaseline="central"
                fontSize={short.length >= 3 ? 10.5 : 12} fontWeight={state === 'none' ? 500 : 800}
                fill={state === 'visited' ? onColor(color) : 'var(--tc-ink-900)'}>{short}</text>
            </g>
          );
        })}
      </svg>
      {pop && <FootPopup at={pop} />}
    </div>
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

const WORLD_W = (360 / WORLD_STEP) * C;
const WORLD_H = WORLD_ROWS.length * C;
const isLand = (r: number, c: number) => {
  const ch = WORLD_ROWS[r]?.[c];
  return ch !== undefined && ch !== '.';
};

export const WorldTileMap: React.FC<{ points: MapPoint[] }> = ({ points }) => {
  const visited = points.filter((p) => p.state === 'visited');
  const planned = points.filter((p) => p.state === 'planned');
  const label = `世界の地図。行った場所 ${visited.length} か所、計画中 ${planned.length} か所`
    + (points.length ? `(${[...new Set(points.map((p) => p.label.split('・')[0]))].slice(0, 8).join('、')})` : '');
  const { hover, setHover, leave, frame } = useHover<{ r: number; c: number }>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const c = Math.floor(((e.clientX - box.left) / box.width) * (WORLD_W / C));
    const r = Math.floor(((e.clientY - box.top) / box.height) * (WORLD_H / C));
    if (!isLand(r, c)) return; // 海の上では今の升目のまま(揺れない)
    if (!hover || hover.r !== r || hover.c !== c) { tick(); setHover({ r, c }); }
  };
  const raised = useMemo(() => {
    if (!hover) return [];
    const out: Array<{ r: number; c: number; lift: 1 | 2 }> = [];
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const r = hover.r + dr; const c = hover.c + dc;
      if ((dr || dc) && isLand(r, c)) out.push({ r, c, lift: 1 });
    }
    out.push({ r: hover.r, c: hover.c, lift: 2 });
    return out;
  }, [hover]);
  const trips = hover ? tripsNearCell(points, hover.r, hover.c) : [];
  const pop: PopupAt | null = hover && trips.length
    ? { title: trips.length === 1 ? 'この場所の旅行' : `この辺りの旅行(${trips.length} 件)`, trips,
      x: (hover.c + 0.5) / (WORLD_W / C), top: (hover.r - 1) / (WORLD_H / C), bottom: (hover.r + 2) / (WORLD_H / C) }
    : null;
  return (
    <div className="tc-fp-stage" ref={frame} onPointerLeave={leave} onPointerDown={unlockSound}>
      <svg ref={svgRef} viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} className="tc-fp-map tc-fp-world" role="img" aria-label={label}
        data-testid="footprint-world" onPointerMove={move} onClick={move}>
        <g aria-hidden="true">
          {WORLD_ROWS.map((row, r) => Array.from(row).map((ch, c) => (ch === '.' ? null : (
            <rect key={`${r}-${c}`} x={c * C + 0.5} y={r * C + 0.5} width={C - 1} height={C - 1} rx={1.4}
              fill={AREA_COLOR[ch] ?? '#94a3b8'} fillOpacity={ch === 'J' ? 0.55 : 0.32} />
          ))))}
        </g>
        {/* 浮かせた升目(周り → 当てた升目の順に上へ重ねる) */}
        <g aria-hidden="true" data-testid="footprint-world-raised">
          {raised.map(({ r, c, lift }) => {
            const ch = WORLD_ROWS[r]![c]!;
            return (
              <rect key={`${r}-${c}`} className="tc-fp-cell" data-lift={lift} x={c * C + 0.5} y={r * C + 0.5} width={C - 1}
                height={C - 1} rx={1.4} fill={AREA_COLOR[ch] ?? '#94a3b8'} fillOpacity={lift === 2 ? 0.95 : 0.6} />
            );
          })}
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
      {pop && <FootPopup at={pop} />}
    </div>
  );
};

export const AreaLegend: React.FC = () => (
  <ul className="tc-fp-regions" aria-label="地域の色">
    {['A', 'J', 'E', 'N', 'S', 'F', 'O'].map((k) => (
      <li key={k}><span style={{ background: AREA_COLOR[k] }} aria-hidden="true" />{AREA_LABEL[k]}</li>
    ))}
  </ul>
);
