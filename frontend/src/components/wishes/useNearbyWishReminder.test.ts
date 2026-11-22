/** [FR-062] 近くに来たら知らせる: 半径の中・同じ場所は 1 日 1 回・エリアは radius_m・サーバーに位置を送らない */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/services/api/spotIntake', () => ({ listWishSpots: m.list }));
vi.mock('@/utils/offlineVault', () => ({ saveSnapshot: vi.fn(async () => true), loadSnapshot: vi.fn(async () => null) }));
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => null }));

import { markShown, pickHit, REMIND_RADIUS_M } from './useNearbyWishReminder';

const spots = [
  { id: 'a', name: '赤福 本店', lat: 34.4623, lng: 136.7256, radius_m: REMIND_RADIUS_M },
  { id: 'z', name: 'おかげ横丁', lat: 34.4700, lng: 136.7256, radius_m: 1000 },
];

beforeEach(() => { localStorage.clear(); m.list.mockReset(); });

describe('近くに来たら知らせる', () => {
  it('300m の中に入った一番近い場所を返す。エリアは radius_m', () => {
    expect(pickHit(spots, 34.4633, 136.7256)?.spot.id).toBe('a');
    expect(pickHit(spots, 34.4633, 136.7256)?.distance_m).toBeGreaterThan(100);
    expect(pickHit(spots, 34.4660, 136.7256)?.spot.id).toBe('z');  // 赤福から 410m・エリアの 1000m の中
    expect(pickHit(spots, 34.50, 136.7256)).toBeNull();
  });
  it('同じ場所は 1 日 1 回。次の日はまた出す', () => {
    const d1 = new Date(2026, 10, 28, 10);
    markShown('a', d1);
    expect(pickHit(spots, 34.4623, 136.7256, d1)?.spot.id).not.toBe('a');
    expect(pickHit(spots, 34.4623, 136.7256, new Date(2026, 10, 29, 10))?.spot.id).toBe('a');
  });
  it('この画面の判定はサーバーに位置を送らない(一覧の取得だけ)', () => {
    pickHit(spots, 34.4623, 136.7256);
    expect(m.list).not.toHaveBeenCalled();
  });
});
