import { describe, it, expect, beforeEach } from 'vitest';
import type { TrackPoint } from '@/services/api';
import {
  FLUSH_SIZE, addPending, appendLocalPoint, clearLocalTrack, deleteLocalRange, distanceM, loadLocalPoints, loadPending,
  pendingCount, removePending, shouldKeep, toTrackPoint, totalDistanceM,
} from './trackRecorder';

const pt = (sec: number, lat = 35.0, lng = 135.0, acc: number | null = 10): TrackPoint => ({
  recorded_at: new Date(Date.UTC(2026, 10, 1, 1, 0, sec)).toISOString(), latitude: lat, longitude: lng, accuracy_m: acc,
});

beforeEach(() => localStorage.clear());

describe('trackRecorder (Gate P13)', () => {
  it('距離と間引き', () => {
    expect(Math.round(distanceM(pt(0), pt(1, 35.01)))).toBe(1112);
    expect(Math.round(totalDistanceM([pt(10, 35.02), pt(0), pt(5, 35.01)]))).toBe(2224);
    expect(shouldKeep(null, pt(0), 'standard')).toBe(true);
    expect(shouldKeep(pt(0), pt(10, 35.0001), 'standard')).toBe(false); // 11m・10秒
    expect(shouldKeep(pt(0), pt(10, 35.0003), 'standard')).toBe(true); // 33m
    expect(shouldKeep(pt(0), pt(61), 'standard')).toBe(true); // 60秒経過
    expect(shouldKeep(pt(0), pt(10, 35.0001), 'high')).toBe(true); // 11m ≥ 5m
    expect(shouldKeep(pt(0), pt(200, 35.0003), 'low')).toBe(false);
    expect(shouldKeep(null, pt(0, 35, 135, 5000), 'high')).toBe(false); // 精度が悪い
    expect(shouldKeep(pt(5), pt(5, 36), 'high')).toBe(false); // 時刻が進んでいない
  });

  it('位置の取得結果を点にする', () => {
    const p = toTrackPoint({ timestamp: Date.UTC(2026, 10, 1), coords: { latitude: 1, longitude: 2, accuracy: 12.345 } } as GeolocationPosition);
    expect(p).toEqual({ recorded_at: '2026-11-01T00:00:00.000Z', latitude: 1, longitude: 2, accuracy_m: 12.3 });
  });

  it('端末だけの保存と、時間帯の削除・軌跡の削除', () => {
    for (const s of [0, 10, 20, 30]) appendLocalPoint('t1', pt(s));
    expect(loadLocalPoints('t1')).toHaveLength(4);
    expect(deleteLocalRange('t1', pt(5).recorded_at, pt(20).recorded_at)).toBe(2);
    expect(loadLocalPoints('t1').map((p) => p.recorded_at)).toEqual([pt(0).recorded_at, pt(30).recorded_at]);
    localStorage.setItem('tc_track_points_t2', '{broken');
    expect(loadLocalPoints('t2')).toEqual([]);
    clearLocalTrack('t1');
    expect(loadLocalPoints('t1')).toEqual([]);
  });

  it('未送信の点はまとまりごとにbatch_idを持ち、送れたまとまりだけ外す', () => {
    for (let i = 0; i < FLUSH_SIZE + 2; i += 1) addPending('t1', pt(i));
    const batches = loadPending('t1');
    expect(batches.map((b) => b.points.length)).toEqual([FLUSH_SIZE, 2]);
    expect(batches[0]!.batch_id).not.toBe(batches[1]!.batch_id);
    expect(pendingCount('t1')).toBe(FLUSH_SIZE + 2);
    removePending('t1', batches[0]!.batch_id);
    expect(loadPending('t1').map((b) => b.batch_id)).toEqual([batches[1]!.batch_id]);
    clearLocalTrack('t1');
    expect(pendingCount('t1')).toBe(0);
  });
});
