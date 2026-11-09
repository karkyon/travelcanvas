/** [Gate Footprints2] 旅の足あと: 日本(都道府県の升目)と世界(陸の升目+訪問場所の点)の切り替え。 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/g9Responses.json';
import { decodeDashboard } from '@/services/api/decodersG9';
import { Footprints } from './HomeSections';
import { PREF_TILES, footPeriod, neighborPrefs, project, recentFootTrips, tripsNearCell } from './footprintModel';
import { WORLD_ROWS } from './worldGrid';

const home = (fp: Record<string, unknown>) => {
  const d = decodeDashboard({ ...fx.dashboard_upcoming, home: {
    shelves: { planning: 0, considering: 0, visited: 0, cancelled: 0 }, planning: [], tasks: [],
    memories: { recent: null, timeline: [] },
    footprints: { prefectures: [], planned_prefectures: [], all_prefectures: [], trips_visited: 0, days_this_year: 0, photos: 0, ...fp },
    wishlist: { count: 0, groups: [] },
  } });
  return d.home!;
};
const show = (fp: Record<string, unknown>) => render(<MemoryRouter><Footprints home={home(fp)} /></MemoryRouter>);

beforeEach(() => { try { window.localStorage.removeItem('tc.footprintView'); } catch { /* 保存できない環境 */ } });

describe('足あとの地図', () => {
  it('47 都道府県の升目は重ならない', () => {
    expect(PREF_TILES).toHaveLength(47);
    for (let i = 0; i < PREF_TILES.length; i++) for (let j = i + 1; j < PREF_TILES.length; j++) {
      const [, , ax, ay, aw, ah] = PREF_TILES[i]!; const [, , bx, by, bw, bh] = PREF_TILES[j]!;
      expect(ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah, `${PREF_TILES[i]![0]} / ${PREF_TILES[j]![0]}`).toBe(false);
    }
    expect(WORLD_ROWS.every((r) => r.length === WORLD_ROWS[0]!.length)).toBe(true);
    const tokyo = project(35.68, 139.76);
    const paris = project(48.86, 2.35);
    expect(tokyo.x).toBeGreaterThan(paris.x);
    expect(tokyo.y).toBeGreaterThan(paris.y);
  });

  it('日本: 行った県は塗り、計画中は点線。世界へ切り替えると点で場所を出し、選んだ方を覚える', () => {
    show({ prefectures: ['京都府'], planned_prefectures: ['三重県'],
      points: [{ lat: 35.0, lng: 135.77, state: 'visited', label: '京都・清水寺' }, { lat: 48.86, lng: 2.35, state: 'planned', label: 'パリ・ルーヴル' }],
      overseas_trips: 1 });
    const jp = screen.getByTestId('footprint-japan');
    expect(jp.querySelector('[data-pref="京都府"]')).toHaveAttribute('data-state', 'visited');
    expect(jp.querySelector('[data-pref="三重県"]')).toHaveAttribute('data-state', 'planned');
    expect(screen.getByTestId('footprint-view-japan')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('footprint-view-world'));
    const world = screen.getByTestId('footprint-world');
    expect(world.querySelectorAll('.tc-fp-dot[data-state="visited"]')).toHaveLength(1);
    expect(world.querySelectorAll('.tc-fp-dot[data-state="planned"]')).toHaveLength(1);
    expect(world).toHaveAccessibleName(/行った場所 1 か所、計画中 1 か所/);
    expect(window.localStorage.getItem('tc.footprintView')).toBe('world');
  });

  it('日本の県が無く海外の場所だけある時は世界から出す', () => {
    show({ points: [{ lat: 48.86, lng: 2.35, state: 'visited', label: 'パリ' }], overseas_trips: 1 });
    expect(screen.getByTestId('footprint-world')).toBeInTheDocument();
  });

  it('県に触れると 2 段に浮かび、その県の旅行(新しい順・最大 5 件)が出て旅行を開ける', () => {
    const trips = Array.from({ length: 6 }, (_, i) => ({ plan_id: `p${i}`, title: `京都の旅${i}`, start_date: `2026-0${i + 1}-10`, end_date: `2026-0${i + 1}-11`, state: 'visited' }));
    show({ prefectures: ['京都府'], pref_trips: { '京都府': trips } });
    const jp = screen.getByTestId('footprint-japan');
    fireEvent.pointerEnter(jp.querySelector('[data-pref="京都府"]')!);
    expect(jp.querySelector('[data-pref="京都府"]')).toHaveAttribute('data-lift', '2');
    expect(jp.querySelector('[data-pref="大阪府"]')).toHaveAttribute('data-lift', '1');
    expect(jp.querySelector('[data-pref="北海道"]')).toHaveAttribute('data-lift', '0');
    const rows = screen.getAllByTestId('footprint-popup-trip');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('京都の旅5');
    expect(rows[0]).toHaveAttribute('href', '/planner/p5');
  });

  it('旅行の無い県では浮かぶだけでポップアップは出ない', () => {
    show({ prefectures: [] });
    const jp = screen.getByTestId('footprint-japan');
    fireEvent.pointerEnter(jp.querySelector('[data-pref="青森県"]')!);
    expect(jp.querySelector('[data-pref="青森県"]')).toHaveAttribute('data-lift', '2');
    expect(screen.queryByTestId('footprint-popup')).toBeNull();
  });

  it('音の切り替えを覚える', () => {
    try { window.localStorage.removeItem('tc.footSound'); } catch { /* 保存できない環境 */ }
    show({ prefectures: ['京都府'] });
    const btn = screen.getByTestId('footprint-sound');
    const before = btn.getAttribute('aria-pressed');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).not.toBe(before);
    expect(window.localStorage.getItem('tc.footSound')).toBe(before === 'true' ? 'off' : 'on');
  });

  it('期間の表示・同じ旅行の重なり・近くの点の旅行', () => {
    expect(footPeriod({ start_date: '2026-11-28', end_date: '2026-11-29' })).toBe('2026/11/28(土)〜11/29(日)');
    expect(footPeriod({ start_date: '2026-12-31', end_date: '2027-01-01' })).toBe('2026/12/31(木)〜2027/1/1(金)');
    expect(footPeriod({ start_date: null, end_date: null })).toBe('日付未定');
    const a = { plan_id: 'a', title: 'A', start_date: '2026-01-01', end_date: null, state: 'planned' as const };
    expect(recentFootTrips([a, { ...a, state: 'visited' }])).toEqual([{ ...a, state: 'visited' }]);
    expect(neighborPrefs('京都府').has('大阪府')).toBe(true);
    expect(neighborPrefs('京都府').has('京都府')).toBe(false);
    const { x, y } = project(48.86, 2.35);
    const near = tripsNearCell([{ lat: 48.86, lng: 2.35, state: 'visited', label: 'パリ', trips: [a] }], Math.floor(y / 6), Math.floor(x / 6));
    expect(near.map((t) => t.plan_id)).toEqual(['a']);
  });
});
