import { describe, it, expect } from 'vitest';
import { diffLabel, localTime, metricRows, percent, zonedToIso } from './journeyModel';

describe('journeyModel (Gate P14)', () => {
  it('日程のタイムゾーンで時刻を変換する(端末のタイムゾーンに依存しない)', () => {
    expect(zonedToIso('2026-11-01', '10:00', 'Asia/Tokyo')).toBe('2026-11-01T01:00:00.000Z');
    expect(zonedToIso('2026-07-01', '10:00', 'Europe/Paris')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToIso('2026-11-01', '25:00', 'Asia/Tokyo')).toBeNull();
    expect(zonedToIso('2026-11-01', '10:00', 'Mars/Base')).toBeNull();
    expect(localTime('2026-11-01T01:25:00+00:00', 'Asia/Tokyo')).toBe('10:25');
    expect(localTime(null, 'Asia/Tokyo')).toBe('');
  });

  it('指標は分母0を「—」で示し、差を言葉にする', () => {
    expect(percent(null)).toBe('—');
    expect(percent(0.3333)).toBe('33%');
    expect(diffLabel(25)).toBe('予定より25分遅れ');
    expect(diffLabel(-5)).toBe('予定より5分早い');
    expect(diffLabel(0)).toBe('予定どおり');
    const rows = metricRows({
      planned_events: 3, visited: 1, skipped: 1, unrecorded: 1, plan_achievement_rate: 0.3333, visit_rate: 0.5,
      photo_visit_rate: null, record_completion_rate: 0.6667, memory_events: 1, stay_minutes: 65, timed_visits: 1,
      track_distance_m: null, algorithm_version: 'journey-v1',
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['計画達成率', '33%'], ['訪問達成率', '50%'], ['写真付き訪問率', '—'], ['記録完成率', '67%'], ['滞在時間', '1時間5分'], ['移動距離', '—'],
    ]);
  });
});
