/**
 * [Gate P4] しおり画面の整形・入力検証(bookletModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTIONS, defaultValidUntil, describeIncludes, eventTypeLabel, isSensitive, orderSections, tocSections,
  validUntilToIso,
} from './bookletModel';

describe('bookletModel (Gate P4)', () => {
  it('章は決まった順に並べ、目次には表紙・目次を載せない', () => {
    expect(orderSections(['notes', 'cover', 'schedule'])).toEqual(['cover', 'schedule', 'notes']);
    expect(tocSections(DEFAULT_OPTIONS.sections)).toEqual(['schedule', 'map', 'reservations', 'packing', 'contacts', 'costs', 'notes']);
  });

  it('機密項目の判定と表示', () => {
    expect(isSensitive(DEFAULT_OPTIONS.includes)).toBe(false);
    const inc = { ...DEFAULT_OPTIONS.includes, phones: true, confirmation_numbers: true };
    expect(isSensitive(inc)).toBe(true);
    expect(describeIncludes(inc)).toBe('含む機密項目: 予約番号・電話番号');
    expect(describeIncludes(DEFAULT_OPTIONS.includes)).toBe('機密項目なし');
  });

  it('有効期限: 初期値は旅行の翌週(過ぎていれば30日後)で90日以内、過去と90日超は拒否', () => {
    const now = new Date('2026-10-11T12:00:00');
    expect(defaultValidUntil('2026-11-03', now)).toBe('2026-11-10');
    expect(defaultValidUntil('2026-01-01', now)).toBe('2026-11-10');
    expect(defaultValidUntil('2027-12-01', now)).toBe('2027-01-09');
    expect(defaultValidUntil(null, now)).toBe('2026-11-10');
    expect(validUntilToIso('2026-10-10', now)).toEqual({ ok: false, error: '有効期限には今日以降の日付を指定してください' });
    expect(validUntilToIso('2027-03-01', now).ok).toBe(false);
    expect(validUntilToIso('', now).ok).toBe(false);
    const ok = validUntilToIso('2026-10-20', now);
    expect(ok.ok && new Date(ok.data).getTime()).toBe(new Date('2026-10-20T23:59:59').getTime());
  });

  it('予定の種類は文字で示す(白黒でも区別できる)。未知の値はそのまま', () => {
    expect(eventTypeLabel('sightseeing')).toBe('観光');
    expect(eventTypeLabel('custom')).toBe('custom');
  });
});
