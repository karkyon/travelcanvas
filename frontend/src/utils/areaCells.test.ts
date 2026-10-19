/** [Gate L5] 「訪問地域だけ同期」の区画の集計(生の座標は送らない)。 */
import { describe, it, expect } from 'vitest';
import type { TrackPoint } from '@/services/api';
import { aggregateAreaCells, areaKey, chunkCells } from './areaCells';

const at = (min: number, lat: number, lng: number): TrackPoint => ({
  recorded_at: new Date(Date.UTC(2026, 10, 1, 1, min)).toISOString(), latitude: lat, longitude: lng, accuracy_m: 10,
});

describe('areaCells (Gate L5)', () => {
  it('区画の印は backend・Atlas と同じ形(南西の角、0.1度)', () => {
    expect(areaKey(34.9948, 135.785)).toBe('0.1:34.9:135.7');
    expect(areaKey(35.0, 135.8)).toBe('0.1:35.0:135.8');
    expect(areaKey(-0.05, -0.05)).toBe('0.1:-0.1:-0.1');
    expect(areaKey(0.05, 0.05)).toBe('0.1:0.0:0.0');
    expect(areaKey(-33.8688, 151.2093)).toBe('0.1:-33.9:151.2');
  });

  it('滞在時間は次の点までの時間の合計(15分を超える空きは数えない)。座標は結果に含まない', () => {
    const cells = aggregateAreaCells([
      at(40, 35.05, 135.75), at(0, 34.95, 135.75), at(10, 34.96, 135.76), at(20, 34.97, 135.75), at(90, 35.05, 135.75),
    ]);
    // A: 0→10・10→20 の20分(20→40 は空きが20分なので数えない)。B: 40→90 は50分空くので0
    expect(cells.map((c) => [c.key, c.dwell_seconds, c.samples])).toEqual([
      ['0.1:34.9:135.7', 20 * 60, 3],
      ['0.1:35.0:135.7', 0, 2],
    ]);
    for (const c of cells) {
      expect(Object.keys(c).sort()).toEqual(['dwell_seconds', 'first_at', 'key', 'last_at', 'samples']);
      expect(c.dwell_seconds).toBeLessThanOrEqual((Date.parse(c.last_at) - Date.parse(c.first_at)) / 1000);
    }
  });

  it('送る単位に分ける', () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ key: `k${i}`, first_at: '', last_at: '', dwell_seconds: 0, samples: 1 }));
    expect(chunkCells(many).map((c) => c.length)).toEqual([200, 200, 50]);
  });
});
