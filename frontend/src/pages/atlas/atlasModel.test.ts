import { describe, it, expect } from 'vitest';
import type { AtlasCell } from '@/services/api';
import { cellLabel, layout, percent } from './atlasModel';

const cell = (key: string, lat: number, lng: number, state: AtlasCell['state'] = 'VISITED'): AtlasCell => ({
  key, lat_min: lat, lat_max: Math.round((lat + 0.1) * 10) / 10, lng_min: lng, lng_max: Math.round((lng + 0.1) * 10) / 10,
  state, first_at: null, last_at: null, trips: [], evidence: {},
});

describe('atlasModel (Gate P15)', () => {
  it('区画の名前(方角つき)', () => {
    expect(cellLabel(cell('a', 34.9, 135.7))).toBe('北緯34.9〜35°・東経135.7〜135.8°');
    expect(cellLabel(cell('b', -33.9, -70.7))).toBe('南緯33.8〜33.9°・西経70.6〜70.7°');
  });

  it('北を上にして配置し、状態で塗る', () => {
    const { rects, width, height } = layout([cell('a', 34.9, 135.7, 'STAYED'), cell('b', 35.0, 135.8, 'PLANNED')], 300);
    expect(width).toBe(300);
    expect(height).toBe(300);
    const a = rects.find((r) => r.key === 'a')!;
    const b = rects.find((r) => r.key === 'b')!;
    expect(a.y).toBeGreaterThan(b.y); // 南の区画が下
    expect(a.x).toBeLessThan(b.x);
    expect(a.title).toMatch(/^滞在: /);
    expect(layout([]).rects).toEqual([]);
    expect(percent(null)).toBe('—');
    expect(percent(0.3333)).toBe('33%');
  });
});
