/**
 * [Gate P8] カレンダー取込画面の表示・送信内容(calendarImportModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import type { CalendarImportCandidate } from '@/services/api';
import { SKIP_REASON_TEXT, describeChanges, describeWhen, selectable, toApplyItems } from './calendarImportModel';

const cand = (o: Partial<CalendarImportCandidate>): CalendarImportCandidate => ({
  index: 0, uid: null, title: '清水寺', local_date: '2026-11-01', local_start_time: '10:00', is_all_day: false,
  address: null, action: 'create', reason: null, event_id: null, changes: null, day_exists: true, ...o,
});

describe('calendarImportModel (Gate P8)', () => {
  it('取り込まない理由をすべて日本語で説明する', () => {
    for (const r of ['recurring', 'cancelled', 'unchanged', 'locked', 'duplicate', 'no_day'] as const) {
      expect(SKIP_REASON_TEXT[r]).toBeTruthy();
    }
  });

  it('変更の前後と日時を表示する(未設定・終日・はい/いいえ)', () => {
    expect(describeChanges(cand({ action: 'update', changes: {
      local_start_time: { before: '10:00', after: '11:30' }, address: { before: null, after: '京都' },
      is_all_day: { before: false, after: true },
    } }))).toBe('開始時刻 10:00 → 11:30、場所 未設定 → 京都、終日 いいえ → はい');
    expect(describeWhen(cand({}))).toBe('2026-11-01 10:00');
    expect(describeWhen(cand({ is_all_day: true, local_start_time: null }))).toBe('2026-11-01 終日');
    expect(describeWhen(cand({ local_start_time: null }))).toBe('2026-11-01 時刻未定');
  });

  it('選んだ追加・変更だけを送る(取り込まない予定は選ばれていても送らない)', () => {
    const list = [
      cand({ index: 0 }),
      cand({ index: 1, action: 'update', event_id: 'e1', title: '金閣寺' }),
      cand({ index: 2, action: 'skip', reason: 'recurring' }),
      cand({ index: 3, title: '未選択' }),
    ];
    expect(selectable(list[2]!)).toBe(false);
    expect(toApplyItems(list, new Set([0, 1, 2]))).toEqual([
      { action: 'create', event_id: null, title: '清水寺', local_date: '2026-11-01', local_start_time: '10:00', is_all_day: false, address: null },
      { action: 'update', event_id: 'e1', title: '金閣寺', local_date: '2026-11-01', local_start_time: '10:00', is_all_day: false, address: null },
    ]);
  });
});
