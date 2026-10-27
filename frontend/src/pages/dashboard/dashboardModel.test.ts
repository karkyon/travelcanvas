/** [Gate G9] UX-4 ダッシュボードの表示の決まり(段階・日付・時刻・操作の権限)。 */
import { describe, it, expect } from 'vitest';
import type { DashboardTrip } from '@/services/api/types/g9';
import {
  eventTime, groupTrips, minutesLabel, quickActions, shortDate, statusLabel, tripDateLabel,
} from './dashboardModel';

const base: DashboardTrip = {
  id: 'p1', title: '京都', destination: '京都', role: 'owner', can_edit: true, start_date: '2026-11-04',
  end_date: '2026-11-05', timezone_id: 'Asia/Tokyo', local_today: '2026-10-28', day_count: 2, total_days: 2,
  phase: 'upcoming', days_until_start: 7, day_number: null, days_since_end: null, member_count: 1,
  created_at: '2026-10-01T00:00:00Z',
};

describe('日付・状況の表示', () => {
  it('日付は曜日つきで、タイムゾーンに依らない', () => {
    expect(shortDate('2026-11-04')).toBe('11/4(水)');
    expect(shortDate('2026-11-04', true)).toBe('2026/11/4(水)');
    expect(shortDate(null)).toBeNull();
    expect(shortDate('abc')).toBeNull();
    expect(tripDateLabel(base)).toBe('2026/11/4(水)〜11/5(木)・2日間');
    expect(tripDateLabel({ ...base, end_date: base.start_date, total_days: 1 })).toBe('2026/11/4(水)・1日間');
    expect(tripDateLabel({ ...base, start_date: null, end_date: null, total_days: null })).toBe('日付未定');
  });

  it('段階ごとの状況', () => {
    expect(statusLabel(base)).toBe('あと7日');
    expect(statusLabel({ ...base, days_until_start: 1 })).toBe('明日から');
    expect(statusLabel({ ...base, phase: 'ongoing', day_number: 2 })).toBe('2日目 / 2日');
    expect(statusLabel({ ...base, phase: 'past', days_since_end: 0 })).toBe('今日まで');
    expect(statusLabel({ ...base, phase: 'past', days_since_end: 9 })).toBe('9日前に終了');
    expect(statusLabel({ ...base, phase: 'undated' })).toBe('日程を決めましょう');
  });

  it('予定の時刻は現地の時刻(local_start_time を優先)と残り時間', () => {
    expect(eventTime({ local_start_time: '06:38:00', start_at: null }, 'Asia/Tokyo')).toBe('06:38');
    expect(eventTime({ local_start_time: null, start_at: '2026-10-27T21:38:00Z' }, 'Asia/Tokyo')).toBe('06:38');
    expect(eventTime({ local_start_time: null, start_at: '2026-10-27T21:38:00Z' }, 'Europe/Paris')).toBe('22:38');
    expect(eventTime({ local_start_time: null, start_at: 'x' }, null)).toBeNull();
    expect(eventTime(null, null)).toBeNull();
    expect(minutesLabel(45)).toBe('あと45分');
    expect(minutesLabel(119)).toBe('あと1時間59分');
    expect(minutesLabel(120)).toBe('あと2時間');
    expect(minutesLabel(null)).toBeNull();
    expect(minutesLabel(-1)).toBeNull();
  });
});

describe('操作(最大4つ・権限の無い操作は出さない)', () => {
  it('旅行前の所有者は招待まで、閲覧者は招待を出さない', () => {
    expect(quickActions(base).map((a) => a.key)).toEqual(['planner', 'preparation', 'reservations', 'share']);
    expect(quickActions(base).find((a) => a.key === 'share')!.to).toBe('/share/p1');
    const viewer = quickActions({ ...base, role: 'viewer', can_edit: false });
    expect(viewer.map((a) => a.key)).toEqual(['planner', 'preparation', 'reservations']);
    expect(quickActions({ ...base, role: 'editor' }).map((a) => a.key)).not.toContain('share');
  });

  it('旅行中・旅行後・日付未定', () => {
    expect(quickActions({ ...base, phase: 'ongoing' }).map((a) => a.to)).toEqual([
      '/planner/p1/today', '/planner/p1/reservations', '/planner/p1/alerts', '/planner/p1']);
    expect(quickActions({ ...base, phase: 'past' }).map((a) => a.key)).toEqual(['expenses', 'memories', 'visits', 'journey']);
    expect(quickActions({ ...base, phase: 'undated' }).map((a) => a.key)).toEqual(['planner', 'candidates', 'share']);
    // 閲覧者は日程を決められない(同じ行き先は1つにまとめる)
    expect(quickActions({ ...base, phase: 'undated', role: 'viewer', can_edit: false }).map((a) => a.key))
      .toEqual(['candidates', 'open']);
    for (const phase of ['ongoing', 'upcoming', 'past', 'undated'] as const) {
      expect(quickActions({ ...base, phase }).length).toBeLessThanOrEqual(4);
    }
  });

  it('段階ごとにまとめ、空の段階は出さない', () => {
    const g = groupTrips([{ ...base, id: 'a', phase: 'past' }, { ...base, id: 'b' }, { ...base, id: 'c', phase: 'ongoing' }]);
    expect(g.map((x) => [x.phase, x.trips.map((t) => t.id)])).toEqual([['ongoing', ['c']], ['upcoming', ['b']], ['past', ['a']]]);
  });
});
