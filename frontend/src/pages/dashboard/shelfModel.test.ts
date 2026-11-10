/** [Gate ShelfCards] 旅行の一覧のカードの表示(日付の行・札・数) */
import { describe, expect, it } from 'vitest';
import type { DashboardTrip } from '@/services/api/types/g9';
import { shelfBadge, shelfChip, shelfDateLine, shelfStats, shelfStay } from './shelfModel';

const base: DashboardTrip = {
  id: 't1', title: '京都、余白をめぐる旅', destination: '京都', role: 'owner', can_edit: true,
  start_date: '2026-11-21', end_date: '2026-11-23', timezone_id: 'Asia/Tokyo', local_today: '2026-11-10',
  day_count: 3, total_days: 3, phase: 'upcoming', days_until_start: 11, day_number: null, days_since_end: null,
  member_count: 4, created_at: null, cover: null, shelf: 'planning', event_count: 11, photo_count: 0, note_count: 0,
};

describe('shelfModel', () => {
  it('泊数: 日帰り・○泊○日・6 日からは○日間', () => {
    expect(shelfStay(1)).toBe('日帰り');
    expect(shelfStay(3)).toBe('2泊3日');
    expect(shelfStay(7)).toBe('7日間');
    expect(shelfStay(null)).toBeNull();
  });

  it('日付の行: 今年は年を省き、同じ月は終わりの月を省く', () => {
    expect(shelfDateLine(base)).toBe('11/21(土)–23(月) · 2泊3日');
    expect(shelfDateLine({ ...base, start_date: '2027-02-20', end_date: '2027-02-26', total_days: 7 }))
      .toBe('2027/2/20(土)–26(金) · 7日間');
    expect(shelfDateLine({ ...base, start_date: '2026-11-30', end_date: '2026-12-01', total_days: 2 }))
      .toBe('11/30(月)–12/1(火) · 1泊2日');
  });

  it('日付の行: 行った旅は年と月、日付が無ければ未定', () => {
    expect(shelfDateLine({ ...base, phase: 'past', start_date: '2025-10-04', end_date: '2025-10-05', total_days: 2 }))
      .toBe('2025年10月 · 1泊2日');
    expect(shelfDateLine({ ...base, phase: 'undated', start_date: null, end_date: null, total_days: null })).toBe('日付は未定');
  });

  it('表紙の札: 出発まで・行った旅の年・旅行案・見送り', () => {
    expect(shelfChip(base)).toBe('出発まで 11日');
    expect(shelfChip({ ...base, days_until_start: 1 })).toBe('明日から');
    expect(shelfChip({ ...base, phase: 'past', shelf: 'visited', start_date: '2025-10-04' })).toBe('行った旅 · 2025');
    expect(shelfChip({ ...base, phase: 'undated', shelf: 'considering', start_date: null, total_days: 7 })).toBe('7日間 · 旅行案');
    expect(shelfChip({ ...base, shelf: 'cancelled' })).toBe('見送り・中止');
  });

  it('数と状態: 行った旅は写真・メモと「記録あり」、それ以外は予定・写真・共有', () => {
    expect(shelfStats(base)).toEqual(['予定 11', '写真 0', '共有 4名']);
    expect(shelfStats({ ...base, member_count: 1 })).toEqual(['予定 11', '写真 0']);
    const past = { ...base, phase: 'past' as const, shelf: 'visited' as const, photo_count: 24, note_count: 3 };
    expect(shelfStats(past)).toEqual(['写真 24', 'メモ 3']);
    expect(shelfBadge(past)).toBe('記録あり');
    expect(shelfBadge({ ...past, photo_count: 0, note_count: 0 })).toBe('行った旅');
    expect(shelfBadge(base)).toBe('計画中');
  });
});
