/** [Gate L5] FR-056 適応型GPS: 速さ・停止・電池・省電力で位置を取る頻度を変える。記録の観測値を数える。 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TrackPoint } from '@/services/api';
import {
  SamplingStats, addFix, clearStatsSnapshot, loadStatsSnapshot, resumeSnapshot, saveStatsSnapshot, currentSpeed, decideTier, emptyMotion, isLowBattery, keepWithTier, readBattery, stationaryForMs,
} from './adaptiveSampler';
import { PRECISION } from './trackRecorder';

const at = (sec: number, lat = 35.0, lng = 135.0, acc: number | null = 10): TrackPoint => ({
  recorded_at: new Date(Date.UTC(2026, 10, 1, 1, 0, 0) + sec * 1000).toISOString(), latitude: lat, longitude: lng,
  accuracy_m: acc,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adaptiveSampler (Gate L5)', () => {
  it('速さと止まっている時間', () => {
    let m = emptyMotion();
    m = addFix(m, at(0));
    expect(currentSpeed(m)).toBeNull();
    m = addFix(m, at(10, 35.001)); // 約111m / 10秒
    expect(currentSpeed(m)).toBeGreaterThan(10);
    expect(currentSpeed(m, 1.2)).toBe(1.2); // 端末が返す速さを優先
    let still = emptyMotion();
    for (let s = 0; s <= 240; s += 60) still = addFix(still, at(s, 35.0 + (s % 120 ? 0.00005 : 0)));
    expect(stationaryForMs(still)).toBe(240_000);
    still = addFix(still, at(300, 35.01));
    expect(stationaryForMs(still)).toBe(0);
    // 10分より古い位置は持たない
    let long = emptyMotion();
    for (let s = 0; s <= 1200; s += 300) long = addFix(long, at(s));
    expect(long.fixes).toHaveLength(3);
  });

  it('段階: 省電力(手動・電池20%以下で充電していない)> 停止 > 乗り物 > 移動', () => {
    const base = { precision: 'standard' as const, speedMps: 1, stationaryMs: 0, battery: null, lowPowerManual: false };
    expect(decideTier(base)).toMatchObject({ tier: 'moving', pollMs: null, minIntervalMs: PRECISION.standard.minIntervalMs });
    expect(decideTier({ ...base, speedMps: 15 })).toMatchObject({ tier: 'moving_fast', pollMs: null, minDistanceM: 200 });
    expect(decideTier({ ...base, speedMps: 15, stationaryMs: 200_000 })).toMatchObject({ tier: 'stationary', pollMs: 180_000 });
    const low = decideTier({ ...base, battery: { level: 0.15, charging: false } });
    expect(low).toMatchObject({ tier: 'low_power', pollMs: 300_000 });
    expect(low.options.enableHighAccuracy).toBe(false);
    expect(decideTier({ ...base, battery: { level: 0.15, charging: true } }).tier).toBe('moving');
    expect(decideTier({ ...base, lowPowerManual: true }).label).toContain('手動');
    expect(isLowBattery({ level: 0.2, charging: false })).toBe(true);
    expect(isLowBattery(null)).toBe(false);
  });

  it('段階の設定で間引く・精度の悪い位置は残さない', () => {
    const fast = decideTier({ precision: 'high', speedMps: 20, stationaryMs: 0, battery: null, lowPowerManual: false });
    expect(keepWithTier(null, at(0), fast, 2000)).toBe(true);
    expect(keepWithTier(at(0), at(5, 35.0005), fast, 2000)).toBe(false); // 55m・5秒
    expect(keepWithTier(at(0), at(5, 35.002), fast, 2000)).toBe(true); // 222m
    expect(keepWithTier(null, at(0, 35, 135, 5000), fast, 2000)).toBe(false);
  });

  it('記録の観測値: 欠測・最大の空き・段階ごとの時間・電池', () => {
    const s = new SamplingStats();
    s.battery({ level: 0.8, charging: false });
    s.expect(4);
    s.fix(0, true);
    s.fix(60_000, false);
    s.fix(240_000, true, true);
    s.addTierTime('moving', 90_500);
    s.addTierTime('stationary', 0);
    s.battery({ level: 0.7, charging: false });
    expect(s.snapshot()).toEqual({
      expected_samples: 4, kept_samples: 2, missed_samples: 1, manual_points: 1, max_gap_seconds: 180,
      tier_seconds: { moving: 91 }, battery_start: 0.8, battery_end: 0.7,
    });
    const resumed = new SamplingStats(s.snapshot());
    resumed.expect();
    expect(resumed.snapshot().expected_samples).toBe(5);
    expect(resumed.snapshot().missed_samples).toBe(2);
  });

  it('電池の情報(対応していないブラウザは null)', async () => {
    vi.stubGlobal('navigator', { getBattery: async () => ({ level: 0.42, charging: true }) });
    expect(await readBattery()).toEqual({ level: 0.42, charging: true });
    vi.stubGlobal('navigator', {});
    expect(await readBattery()).toBeNull();
    vi.stubGlobal('navigator', { getBattery: async () => { throw new Error('denied'); } });
    expect(await readBattery()).toBeNull();
  });

  it('観測値を端末に置き、画面に戻ったら多く数えている方から続ける', () => {
    localStorage.clear();
    const snap = { expected_samples: 10, kept_samples: 8, missed_samples: 1, manual_points: 1, max_gap_seconds: 60, tier_seconds: {} };
    saveStatsSnapshot('t1', snap);
    expect(loadStatsSnapshot('t1')).toEqual(snap);
    expect(resumeSnapshot(loadStatsSnapshot('t1'), { ...snap, expected_samples: 5, manual_points: 0 })).toEqual(snap);
    expect(resumeSnapshot(null, snap)).toEqual(snap);
    expect(resumeSnapshot(null, null)).toBeUndefined();
    clearStatsSnapshot('t1');
    expect(loadStatsSnapshot('t1')).toBeNull();
  });
});
