/**
 * [Gate V2] 端末で計算する訪問判定の数値(visit-v1)。backend の tests/test_gate_v2_visits.py と同じ場面で同じ値になること。
 */
import { describe, it, expect } from 'vitest';
import type { TrackPoint } from '@/services/api';
import { deviceVisitMetrics } from './visitMetrics';

const KYOTO = { latitude: 34.9948, longitude: 135.785 };
const T0 = Date.UTC(2026, 10, 1, 1, 0, 0);
const off = (north: number, east = 0) => ({
  latitude: KYOTO.latitude + north / 111_320,
  longitude: KYOTO.longitude + east / (111_320 * Math.cos((KYOTO.latitude * Math.PI) / 180)),
});
const pt = (min: number, pos: { latitude: number; longitude: number }, acc: number | null = 10): TrackPoint => ({
  recorded_at: new Date(T0 + min * 60_000).toISOString(), latitude: pos.latitude, longitude: pos.longitude, accuracy_m: acc,
});

describe('deviceVisitMetrics (Gate V2)', () => {
  it('滞在: 半径の中の点・滞在時間・速さ。座標は返さない', () => {
    const m = deviceVisitMetrics(KYOTO, 200, [0, 2, 4, 6, 8, 10, 12].map((x) => pt(x, off(20))));
    expect(m).toEqual({ points_total: 7, points_valid: 7, points_inside: 7, dwell_seconds: 720, median_distance_m: 20,
      median_accuracy_m: 10, speed_kmh: 0 });
    expect(Object.keys(m)).not.toContain('latitude');
  });

  it('通過: 速い移動は速さが 15km/h を超える', () => {
    const m = deviceVisitMetrics(KYOTO, 200, [pt(0, off(-150)), pt(0.5, off(150))]);
    expect(m.points_inside).toBe(2);
    expect(m.speed_kmh!).toBeGreaterThan(15);
  });

  it('精度が100mより悪い点は使わない(ちょうど100mは使う)', () => {
    const bad = deviceVisitMetrics(KYOTO, 200, [0, 2, 4].map((x) => pt(x, KYOTO, 150)));
    expect(bad).toMatchObject({ points_total: 3, points_valid: 0, points_inside: 0, dwell_seconds: 0, median_distance_m: null });
    expect(deviceVisitMetrics(KYOTO, 200, [pt(0, KYOTO, 100)]).points_inside).toBe(1);
    expect(deviceVisitMetrics(KYOTO, 200, [pt(0, KYOTO, null)]).median_accuracy_m).toBeNull();
  });

  it('30分より空いた点・半径の外へ出た点で、別の訪問として分ける(一番長い訪問を使う)', () => {
    const m = deviceVisitMetrics(KYOTO, 200, [0, 1, 3, 45, 47, 50].map((x) => pt(x, KYOTO)));
    expect(m).toMatchObject({ points_inside: 6, dwell_seconds: 300 });
    const out = deviceVisitMetrics(KYOTO, 200, [pt(0, KYOTO), pt(2, { latitude: 34.7, longitude: 135.5 }), pt(4, KYOTO)]);
    expect(out).toMatchObject({ points_inside: 2, dwell_seconds: 0, speed_kmh: null });
  });
});
